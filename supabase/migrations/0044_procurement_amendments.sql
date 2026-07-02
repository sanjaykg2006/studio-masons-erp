-- Studio-Masons ERP — Procurement: versioned PO amendments + MD over-budget bypass
-- Run AFTER 0043_procurement_amendment_status.sql (which adds the 'amending' status).
--
-- WHAT THIS ADDS  (see docs/procurement-module-plan.md §4b)
--   An issued PO can be AMENDED (vendor stays fixed): the Procurement Manager
--   opens an amendment, edits line quantities/rates, and the PO goes back through
--   Finance + Director sign-off before being re-released as the next version. Only
--   the latest version is live; goods-receipt history carries forward because the
--   line rows persist. If the amended quantities take a line OVER BUDGET, release
--   also needs the MD's senior bypass (the wildcard holder).
--
--   Model: one order row, a rising version_no, and a light amendment history with a
--   snapshot of the prior lines for the trail. Status 'amending' = a live PO being
--   revised (pre re-release). Writes go through SECURITY DEFINER RPCs.

-- 1. New columns (the 'amending' status was added in 0043) --------------------
alter table public.procurement_orders
  add column if not exists version_no       int not null default 1,
  add column if not exists over_budget      boolean not null default false,
  add column if not exists senior_bypass_by uuid references public.profiles (id),
  add column if not exists senior_bypass_at timestamptz;

create table if not exists public.procurement_order_amendments (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references public.procurement_orders (id) on delete cascade,
  version_no     int not null,
  note           text,
  over_budget    boolean not null default false,
  lines_snapshot jsonb,
  created_by     uuid references public.profiles (id) default auth.uid(),
  created_at     timestamptz not null default now()
);
create index if not exists procurement_order_amendments_order_idx on public.procurement_order_amendments (order_id);

alter table public.procurement_order_amendments enable row level security;
drop policy if exists "procurement_order_amendments_select" on public.procurement_order_amendments;
create policy "procurement_order_amendments_select" on public.procurement_order_amendments
  for select using (public.can_order(order_id, 'read'));

-- 2. Over-budget recompute ----------------------------------------------------
-- A line is over budget when this PO's qty on its budget line, plus what OTHER
-- live POs already commit to the same budget line, exceeds the budgeted qty.
create or replace function public.recompute_order_over_budget(p_order uuid)
returns void
language sql security definer set search_path = public
as $$
  update public.procurement_orders o
     set over_budget = exists (
       select 1
       from public.procurement_order_lines ol
       join public.procurement_budget_lines bl on bl.id = ol.budget_line_id
       where ol.order_id = o.id
         and ol.qty_ordered + coalesce((
           select sum(ol2.qty_ordered)
           from public.procurement_order_lines ol2
           join public.procurement_orders o2 on o2.id = ol2.order_id
           where ol2.budget_line_id = ol.budget_line_id
             and o2.id <> o.id
             and o2.status in ('issued', 'closed', 'amending')
         ), 0) > bl.qty
     )
   where o.id = p_order;
$$;

-- 3. Open an amendment on an issued PO ----------------------------------------
create or replace function public.start_amendment(p_order uuid, p_note text)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_project uuid; v_status public.procurement_order_status; v_ver int; v_snap jsonb;
begin
  select project_id, status, version_no into v_project, v_status, v_ver
  from public.procurement_orders where id = p_order;
  if v_project is null then raise exception 'Order not found'; end if;
  if not public.has_project_permission(v_project, 'procurement.order', 'update') then
    raise exception 'Not authorized to amend this PO';
  end if;
  if v_status <> 'issued' then raise exception 'Only a live (issued) PO can be amended'; end if;

  select jsonb_agg(jsonb_build_object(
           'description', ol.description, 'qty_ordered', ol.qty_ordered, 'rate', ol.rate))
    into v_snap
  from public.procurement_order_lines ol where ol.order_id = p_order;

  insert into public.procurement_order_amendments (order_id, version_no, note, lines_snapshot)
  values (p_order, v_ver, nullif(trim(p_note), ''), v_snap);

  update public.procurement_orders
     set status = 'amending', version_no = version_no + 1,
         finance_reviewed_by = null, finance_reviewed_at = null,
         director_approved_by = null, director_approved_at = null,
         senior_bypass_by = null, senior_bypass_at = null
   where id = p_order;
end;
$$;

-- 4. Edit a line during an amendment (vendor stays fixed) ---------------------
create or replace function public.amend_order_line(p_line uuid, p_qty numeric, p_rate numeric)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_order uuid; v_project uuid; v_status public.procurement_order_status; v_received numeric;
begin
  select ol.order_id into v_order from public.procurement_order_lines ol where ol.id = p_line;
  if v_order is null then raise exception 'Line not found'; end if;
  select project_id, status into v_project, v_status from public.procurement_orders where id = v_order;
  if not public.has_project_permission(v_project, 'procurement.order', 'update') then
    raise exception 'Not authorized to amend this PO';
  end if;
  if v_status <> 'amending' then raise exception 'Open an amendment first'; end if;
  if p_qty < 0 or p_rate < 0 then raise exception 'Quantity and rate must be zero or more'; end if;

  select coalesce(sum(rl.qty_received), 0) into v_received
  from public.procurement_receipt_lines rl where rl.order_line_id = p_line;
  if p_qty < v_received then
    raise exception 'Ordered quantity cannot drop below what is already received (%).', v_received;
  end if;

  update public.procurement_order_lines set qty_ordered = p_qty, rate = p_rate where id = p_line;
  perform public.recompute_order_over_budget(v_order);
end;
$$;

-- 5. MD senior bypass for an over-budget amendment ----------------------------
-- Only the wildcard holder (MD) qualifies: has_permission('*', …) is true only
-- for a role/team grant on resource '*'.
create or replace function public.senior_bypass_order(p_order uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_project uuid;
begin
  v_project := public.procurement_order_project(p_order);
  if v_project is null then raise exception 'Order not found'; end if;
  if not public.has_permission('*', 'approve') then
    raise exception 'Only the senior (MD) can clear an over-budget PO';
  end if;
  update public.procurement_orders
     set senior_bypass_by = auth.uid(), senior_bypass_at = now()
   where id = p_order;
end;
$$;

-- 6. release_order now also handles the 'amending' state + over-budget gate ----
create or replace function public.release_order(p_order uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_project uuid; v_status public.procurement_order_status;
  v_fin uuid; v_dir uuid; v_over boolean; v_bypass uuid;
begin
  perform public.recompute_order_over_budget(p_order);
  select project_id, status, finance_reviewed_by, director_approved_by, over_budget, senior_bypass_by
    into v_project, v_status, v_fin, v_dir, v_over, v_bypass
  from public.procurement_orders where id = p_order;
  if v_project is null then raise exception 'Order not found'; end if;
  if not public.has_project_permission(v_project, 'procurement.order', 'issue') then
    raise exception 'Not authorized to release orders';
  end if;
  if v_status not in ('draft', 'amending') then raise exception 'This PO is already live'; end if;
  if v_fin is null or v_dir is null then
    raise exception 'Both Finance and Director sign-off are needed before release';
  end if;
  if v_over and v_bypass is null then
    raise exception 'This PO is over budget — it needs the senior (MD) bypass before release';
  end if;
  update public.procurement_orders
     set status = 'issued', issued_by = auth.uid(), issued_at = now()
   where id = p_order;
end;
$$;

-- 7. get_order widened with version + over-budget + bypass --------------------
drop function if exists public.get_order(uuid);
create or replace function public.get_order(p_order uuid)
returns table (
  id uuid, po_number text, vendor_name text,
  status public.procurement_order_status, notes text,
  version_no int, over_budget boolean,
  po_file text, acceptance_file text,
  finance_reviewed_by uuid, finance_reviewed_name text,
  director_approved_by uuid, director_approved_name text,
  senior_bypass_by uuid, senior_bypass_name text,
  issued_at timestamptz,
  can_review boolean, can_approve boolean, can_issue boolean,
  can_receive boolean, can_amend boolean, can_bypass boolean
)
language sql stable security definer set search_path = public
as $$
  select o.id, o.po_number, v.name, o.status, o.notes,
         o.version_no, o.over_budget,
         o.po_file, o.acceptance_file,
         o.finance_reviewed_by, coalesce(fp.full_name, fp.email),
         o.director_approved_by, coalesce(dp.full_name, dp.email),
         o.senior_bypass_by, coalesce(sp.full_name, sp.email),
         o.issued_at,
         public.has_project_permission(o.project_id, 'procurement.order', 'review'),
         public.has_project_permission(o.project_id, 'procurement.order', 'approve'),
         public.has_project_permission(o.project_id, 'procurement.order', 'issue'),
         public.has_project_permission(o.project_id, 'procurement.receipt', 'create'),
         public.has_project_permission(o.project_id, 'procurement.order', 'update'),
         public.has_permission('*', 'approve')
  from public.procurement_orders o
  join public.procurement_vendors v on v.id = o.vendor_id
  left join public.profiles fp on fp.id = o.finance_reviewed_by
  left join public.profiles dp on dp.id = o.director_approved_by
  left join public.profiles sp on sp.id = o.senior_bypass_by
  where o.id = p_order
    and public.has_project_permission(o.project_id, 'procurement.order', 'read');
$$;
