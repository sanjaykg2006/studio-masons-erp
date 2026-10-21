-- 0101 — Inactive vendors, and the projects each vendor is working on.
--
-- A vendor could only be Pending, Approved or Rejected, so there was no way
-- to stop picking one without "rejecting" a vendor that had done nothing
-- wrong. `active` is separate from the approval status: an approved vendor
-- can be switched off (hidden from the PO vendor picker, refused on new POs)
-- and back on, and its existing POs carry on untouched.
--
-- list_vendors also hands back the projects where the vendor has a PO still
-- open (not closed or cancelled), so the directory can show where each one
-- is working — only the projects the viewer could open themselves.

-- ── 1. The switch ────────────────────────────────────────────────────────────
alter table public.procurement_vendors
  add column if not exists active boolean not null default true;

create or replace function public.set_vendor_active(p_vendor uuid, p_active boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.has_permission('procurement.vendor', 'approve') then
    raise exception 'Not authorized to change a vendor''s status';
  end if;
  update public.procurement_vendors set active = p_active where id = p_vendor;
  if not found then raise exception 'Vendor not found'; end if;
end;
$$;

revoke execute on function public.set_vendor_active(uuid, boolean) from public, anon;
grant execute on function public.set_vendor_active(uuid, boolean) to authenticated;

-- ── 2. No new PO for an inactive vendor ──────────────────────────────────────
-- Covers every way a PO is made (from an intent, a re-award) in one place.
create or replace function public.procurement_orders_vendor_active()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if exists (
    select 1 from public.procurement_vendors where id = new.vendor_id and not active
  ) then
    raise exception 'This vendor is inactive — switch it back on in the vendor directory first';
  end if;
  return new;
end;
$$;

drop trigger if exists procurement_orders_vendor_active on public.procurement_orders;
create trigger procurement_orders_vendor_active
  before insert on public.procurement_orders
  for each row execute function public.procurement_orders_vendor_active();

-- ── 3. The directory list, with both ─────────────────────────────────────────
drop function if exists public.list_vendors();
create function public.list_vendors()
returns table (
  id uuid, name text, type public.procurement_vendor_type, trade text,
  contact_name text, contact_phone text, contact_email text,
  address text, gst text, pan text,
  status public.procurement_vendor_status,
  approved_by uuid, approved_by_name text, approved_at timestamptz,
  created_at timestamptz,
  approval_id uuid, stage_label text, can_approve boolean,
  active boolean, projects text[]
)
language sql stable security definer set search_path = public as $$
  select v.id, v.name, v.type, v.trade,
         v.contact_name, v.contact_phone, v.contact_email,
         v.address, v.gst, v.pan,
         v.status,
         v.approved_by, coalesce(p.full_name, p.email), v.approved_at,
         v.created_at,
         a.id,
         case when v.status = 'draft' then a.stages -> a.current ->> 'label' end,
         v.status = 'draft' and a.id is not null and public.approval_block_reason(a.id) is null,
         v.active,
         coalesce((
           select array_agg(distinct pr.name order by pr.name)
           from public.procurement_orders o
           join public.projects pr on pr.id = o.project_id
           where o.vendor_id = v.id
             and o.status::text not in ('closed', 'cancelled')
             and public.can_view_project(pr.id)
         ), '{}')
  from public.procurement_vendors v
  left join public.approval_requests a on a.flow_id = 'vendor' and a.item_id = v.id
  left join public.profiles p on p.id = v.approved_by
  where public.has_permission('procurement.vendor', 'read')
  order by v.name;
$$;

grant execute on function public.list_vendors() to authenticated;
