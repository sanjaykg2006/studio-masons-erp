-- Studio-Masons ERP — Procurement module, slice 1: department + vendor directory
-- Run AFTER 0035_rfi_target_role.sql.
--
-- WHAT THIS ADDS  (see docs/procurement-module-plan.md §2a, §3, §10)
--   The Procurement department and the FIRST of its resources — the global vendor
--   directory. Everything here is company-wide (no project dependency), gated by
--   the ordinary has_permission(), exactly like the Design template library.
--     * the `procurement` department;
--     * the `procurement.vendor` resource, registered so the dept's roles (and
--       Team Access ticks) may hold it;
--     * `procurement_vendors` — the directory itself, + RLS;
--     * two seed roles: Procurement Manager (lead) and Procurement team member.
--
--   Per-project data (budgets, intents, comparisons, orders, receipts) and the
--   per-project vendor-approval layer come in later slices; they lean on the
--   project-aware has_project_permission() gate.

-- 1. Vocabularies -------------------------------------------------------------
do $$ begin
  create type public.procurement_vendor_type as enum ('supplier', 'subcontractor', 'service');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.procurement_vendor_status as enum ('draft', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

-- 2. The department -----------------------------------------------------------
insert into public.departments (key, label, description, is_system)
values (
  'procurement',
  'Procurement',
  'Buys for the company''s projects: vendor directory, budget BOQ, purchase intents, comparison, POs and receipts.',
  false
)
on conflict (key) do nothing;

-- 3. Register the vendor resource --------------------------------------------
-- The 0004 guard only lets a department role hold its own department's modules,
-- so this must exist before the grants in step 6.
insert into public.department_modules (department_id, module_id)
select d.id, 'procurement.vendor'
from public.departments d
where d.key = 'procurement'
on conflict do nothing;

-- Department-specific, not a general/back-office module.
insert into public.module_settings (module_id, is_general)
values ('procurement.vendor', false)
on conflict (module_id) do nothing;

-- 4. The vendor directory (global library) ------------------------------------
create table if not exists public.procurement_vendors (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  type          public.procurement_vendor_type not null default 'supplier',
  trade         text,                              -- trade / category
  contact_name  text,
  contact_phone text,
  contact_email text,
  address       text,
  gst           text,
  pan           text,
  bank_details  jsonb not null default '{}'::jsonb,
  status        public.procurement_vendor_status not null default 'draft',
  approved_by   uuid references public.profiles (id),   -- Finance, on legitimacy sign-off
  approved_at   timestamptz,
  created_by    uuid references public.profiles (id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists procurement_vendors_status_idx on public.procurement_vendors (status);

-- 5. RLS — the global gate ----------------------------------------------------
-- read/create/update/delete map straight to the matching verb; the `approve`
-- (mark legitimate) verb also unlocks update so Finance can set the status.
alter table public.procurement_vendors enable row level security;

drop policy if exists "procurement_vendors_select" on public.procurement_vendors;
create policy "procurement_vendors_select" on public.procurement_vendors
  for select using (public.has_permission('procurement.vendor', 'read'));

drop policy if exists "procurement_vendors_insert" on public.procurement_vendors;
create policy "procurement_vendors_insert" on public.procurement_vendors
  for insert with check (public.has_permission('procurement.vendor', 'create'));

drop policy if exists "procurement_vendors_update" on public.procurement_vendors;
create policy "procurement_vendors_update" on public.procurement_vendors
  for update using (
    public.has_permission('procurement.vendor', 'update')
    or public.has_permission('procurement.vendor', 'approve')
  )
  with check (
    public.has_permission('procurement.vendor', 'update')
    or public.has_permission('procurement.vendor', 'approve')
  );

drop policy if exists "procurement_vendors_delete" on public.procurement_vendors;
create policy "procurement_vendors_delete" on public.procurement_vendors
  for delete using (public.has_permission('procurement.vendor', 'delete'));

-- 6. Seed roles + their grants ------------------------------------------------
-- Two starter roles on the Procurement ladder. Held company-wide (as a global
-- role or via a Team Access tick on this department) — that's how their vendor
-- grants reach the global directory. Finance's `approve` (legitimacy) is NOT
-- seeded onto a role here: Finance is a company-wide grant assigned via /access,
-- and the MD's wildcard already covers it.
do $$
declare v_dept uuid;
begin
  select id into v_dept from public.departments where key = 'procurement';
  if v_dept is null then return; end if;

  insert into public.roles (key, label, department_id, is_system, rank) values
    ('procurement_manager', 'Procurement Manager', v_dept, false, 1),
    ('procurement_member',  'Procurement team member', v_dept, false, 2)
  on conflict (key) do nothing;

  -- Procurement Manager: full run of the directory, including delete.
  insert into public.role_permissions (role_id, resource, action)
  select r.id, 'procurement.vendor', x.action::public.app_action
  from public.roles r
  cross join (values ('read'), ('create'), ('update'), ('delete')) as x(action)
  where r.key = 'procurement_manager'
  on conflict do nothing;

  -- Team member: add and edit vendors (data entry), but not delete.
  insert into public.role_permissions (role_id, resource, action)
  select r.id, 'procurement.vendor', x.action::public.app_action
  from public.roles r
  cross join (values ('read'), ('create'), ('update')) as x(action)
  where r.key = 'procurement_member'
  on conflict do nothing;
end $$;

-- 7. Read + status RPCs -------------------------------------------------------
-- The directory, with the approver's name resolved. SECURITY DEFINER, gated by
-- the read verb.
create or replace function public.list_vendors()
returns table (
  id uuid, name text, type public.procurement_vendor_type, trade text,
  contact_name text, contact_phone text, contact_email text,
  status public.procurement_vendor_status,
  approved_by uuid, approved_by_name text, approved_at timestamptz,
  created_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  select v.id, v.name, v.type, v.trade,
         v.contact_name, v.contact_phone, v.contact_email,
         v.status,
         v.approved_by, coalesce(p.full_name, p.email), v.approved_at,
         v.created_at
  from public.procurement_vendors v
  left join public.profiles p on p.id = v.approved_by
  where public.has_permission('procurement.vendor', 'read')
  order by v.name;
$$;

-- Set a vendor's legitimacy status — the Finance approval gate. Requires the
-- `approve` verb (distinct from ordinary editing).
create or replace function public.set_vendor_status(
  p_vendor uuid,
  p_status public.procurement_vendor_status
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.has_permission('procurement.vendor', 'approve') then
    raise exception 'Not authorized to approve vendors';
  end if;
  update public.procurement_vendors
     set status      = p_status,
         approved_by = case when p_status = 'approved' then auth.uid() else null end,
         approved_at = case when p_status = 'approved' then now() else null end,
         updated_at  = now()
   where id = p_vendor;
  if not found then raise exception 'Vendor not found'; end if;
end;
$$;
