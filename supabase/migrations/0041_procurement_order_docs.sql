-- Studio-Masons ERP — Procurement: PO document + vendor acceptance-letter uploads
-- Run AFTER 0040_procurement_orders.sql.
--
-- WHAT THIS ADDS
--   Two documents per PO — the issued PO file and the vendor's acceptance letter.
--   Bytes live in a PRIVATE Storage bucket written/read by the service role inside
--   gated server actions; the path stored on the order row (behind the order's RLS)
--   is the security boundary. Recording a document needs the `issue` verb (the
--   Procurement Manager). get_order now also returns the two paths.

-- 1. Private bucket -----------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('procurement-docs', 'procurement-docs', false)
on conflict (id) do nothing;

-- 2. Store a document path on the order ---------------------------------------
create or replace function public.set_order_document(
  p_order uuid, p_kind text, p_path text
)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_project uuid;
begin
  v_project := public.procurement_order_project(p_order);
  if v_project is null then raise exception 'Order not found'; end if;
  if not public.has_project_permission(v_project, 'procurement.order', 'issue') then
    raise exception 'Not authorized to attach PO documents';
  end if;
  if p_kind = 'po' then
    update public.procurement_orders set po_file = p_path where id = p_order;
  elsif p_kind = 'acceptance' then
    update public.procurement_orders set acceptance_file = p_path where id = p_order;
  else
    raise exception 'Unknown document kind';
  end if;
end;
$$;

-- 3. get_order now returns the two document paths -----------------------------
-- DROP first: widening the returned table.
drop function if exists public.get_order(uuid);
create or replace function public.get_order(p_order uuid)
returns table (
  id uuid, po_number text, vendor_name text,
  status public.procurement_order_status, notes text,
  po_file text, acceptance_file text,
  finance_reviewed_by uuid, finance_reviewed_name text,
  director_approved_by uuid, director_approved_name text,
  issued_at timestamptz,
  can_review boolean, can_approve boolean, can_issue boolean, can_receive boolean
)
language sql stable security definer set search_path = public
as $$
  select o.id, o.po_number, v.name, o.status, o.notes,
         o.po_file, o.acceptance_file,
         o.finance_reviewed_by, coalesce(fp.full_name, fp.email),
         o.director_approved_by, coalesce(dp.full_name, dp.email),
         o.issued_at,
         public.has_project_permission(o.project_id, 'procurement.order', 'review'),
         public.has_project_permission(o.project_id, 'procurement.order', 'approve'),
         public.has_project_permission(o.project_id, 'procurement.order', 'issue'),
         public.has_project_permission(o.project_id, 'procurement.receipt', 'create')
  from public.procurement_orders o
  join public.procurement_vendors v on v.id = o.vendor_id
  left join public.profiles fp on fp.id = o.finance_reviewed_by
  left join public.profiles dp on dp.id = o.director_approved_by
  where o.id = p_order
    and public.has_project_permission(o.project_id, 'procurement.order', 'read');
$$;
