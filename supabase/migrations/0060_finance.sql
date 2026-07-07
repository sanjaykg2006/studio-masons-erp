-- Studio-Masons ERP — Finance module (the "money desk")
-- Run AFTER 0059_finance_po_prep.sql.
--
-- WHAT THIS ADDS  (see docs/finance-module-plan.md)
--   The Finance department + its roles, a company-wide Managing Director (MD) role,
--   a Project Director role, and the finance workflow that sits on top of
--   Procurement's purchase orders:
--     • finance.invoice  — a vendor's bill against a PO: PM enters → Project Director
--       approves → Accounts books it (GST · other charges · TDS · advance · 5%
--       retention). Booking counts the base value against the project budget.
--     • finance.payment  — a request to pay an approved invoice (partial allowed):
--       PM raises → Project Director approves → Accounts marks paid.
--     • finance.retention — the 5% held for 12 months: an auto register Accounts marks
--       paid on maturity; early release needs a Director request + MD approval.
--     • finance.advance  — the PO advance: requested, Project-Director-approved,
--       Accounts-paid, then consumed against invoices. Plus the PO's fixed-contract
--       window and billing branch (columns added in 0059).
--     • finance.settings — the billing-branch list (Finance/Billing manage it).
--
--   Like the rest of the ERP, all writes go through SECURITY DEFINER RPCs; RLS
--   carries read policies only. Reads/verbs mirror what the access matrix shows.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Department, roles, resources
-- ═══════════════════════════════════════════════════════════════════════════

insert into public.departments (key, label, description, is_system)
values ('finance', 'Finance',
        'The money desk: vendor invoices, payment requests, advances, retention and billing branches.',
        false)
on conflict (key) do nothing;

-- The MD — a top-authority company-wide role. Modelled as a SYSTEM role with the
-- '*' wildcard (like admin): the guard exempts system roles, and the wildcard
-- satisfies every `manage`/override step (PO-cap bypass, early retention release,
-- petty-cash approval) without extra wiring. is_department_wide so it also clears
-- every per-project (has_project_permission) check.
insert into public.roles (key, label, description, is_system, is_department_wide, rank)
values ('md', 'Managing Director', 'Top authority — full access across the company.', true, true, 0)
on conflict (key) do nothing;

insert into public.role_permissions (role_id, resource, action)
select r.id, '*', a.action
from public.roles r
cross join (select unnest(enum_range(null::public.app_action)) as action) a
where r.key = 'md'
on conflict do nothing;

-- Register the finance resources to the Finance department (so its roles may hold
-- them) and to Project Management (so the PM / Project Director may hold the verbs
-- they use). finance.settings is Finance-only.
insert into public.department_modules (department_id, module_id)
select d.id, m.module_id
from public.departments d
cross join (values
  ('finance.invoice'), ('finance.payment'), ('finance.retention'), ('finance.advance')
) as m(module_id)
where d.key in ('finance', 'project_management')
on conflict do nothing;

insert into public.department_modules (department_id, module_id)
select d.id, m.module_id
from public.departments d
cross join (values ('finance.settings'), ('project')) as m(module_id)
where d.key = 'finance'
on conflict do nothing;

insert into public.module_settings (module_id, is_general) values
  ('finance.invoice', false),
  ('finance.payment', false),
  ('finance.retention', false),
  ('finance.advance', false),
  ('finance.settings', false)
on conflict (module_id) do nothing;

-- Finance department roles.
do $$
declare v_fin uuid; v_pm uuid;
begin
  select id into v_fin from public.departments where key = 'finance';
  insert into public.roles (key, label, department_id, is_system, is_department_wide, rank) values
    ('finance_head',    'Finance Head',      v_fin, false, true, 1),
    ('accounts_head',   'Accounts Head',     v_fin, false, true, 2),
    ('accounts_member', 'Accounts Team',     v_fin, false, true, 3),
    ('billing_member',  'Billing Team',      v_fin, false, true, 4)
  on conflict (key) do nothing;

  -- Project Director — the senior project-management authority who signs off
  -- invoices, payment requests and advances. Sits above the PM Lead.
  select id into v_pm from public.departments where key = 'project_management';
  insert into public.roles (key, label, department_id, is_system, is_department_wide, rank) values
    ('pm_director', 'Project Director', v_pm, false, true, 1)
  on conflict (key) do nothing;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Tables
-- ═══════════════════════════════════════════════════════════════════════════

do $$ begin
  create type public.finance_invoice_status as enum
    ('pending_director', 'pending_accounts', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.finance_payment_status as enum
    ('pending_director', 'approved', 'paid', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.finance_retention_status as enum ('held', 'paid');
exception when duplicate_object then null; end $$;

-- A vendor invoice raised against a purchase order.
create table if not exists public.finance_invoices (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references public.projects (id) on delete cascade,
  order_id             uuid not null references public.procurement_orders (id) on delete restrict,
  vendor_id            uuid not null references public.procurement_vendors (id),
  invoice_no           text not null,                 -- our internal id, e.g. SM-INV-0007
  vendor_invoice_no    text not null,                 -- the vendor's real bill number
  vendor_invoice_date  date not null,
  due_date             date,                          -- agreed payment due date
  status               public.finance_invoice_status not null default 'pending_director',
  base_value           numeric not null default 0,    -- Σ line base (pre-GST) — booked vs budget
  gst_amount           numeric not null default 0,
  other_charges        numeric not null default 0,
  amount_total         numeric not null default 0,    -- base + gst + other
  tds_pct              numeric,
  tds_amount           numeric not null default 0,
  advance_deducted     numeric not null default 0,
  retention_held       boolean not null default false,
  retention_amount     numeric not null default 0,
  amount_payable       numeric not null default 0,    -- after advance, TDS, retention
  requested_amount     numeric not null default 0,    -- cumulative raised in payment requests
  file_path            text,                          -- uploaded invoice document
  remarks              text,
  director_approved_by uuid references public.profiles (id),
  director_approved_at timestamptz,
  accounts_approved_by uuid references public.profiles (id),
  accounts_approved_at timestamptz,
  cap_bypass_by        uuid references public.profiles (id),  -- PO-cap override (PD/MD)
  cap_bypass_at        timestamptz,
  created_by           uuid references public.profiles (id) default auth.uid(),
  created_at           timestamptz not null default now()
);
create index if not exists finance_invoices_project_idx on public.finance_invoices (project_id);
create index if not exists finance_invoices_order_idx   on public.finance_invoices (order_id);

-- The invoice's GST base lines (up to 4), each with its own SGST/CGST/IGST.
create table if not exists public.finance_invoice_lines (
  id         uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.finance_invoices (id) on delete cascade,
  base       numeric not null default 0,
  sgst       numeric not null default 0,
  cgst       numeric not null default 0,
  igst       numeric not null default 0,
  sort       int not null default 0
);
create index if not exists finance_invoice_lines_invoice_idx on public.finance_invoice_lines (invoice_id);

-- A request to pay (part of) an approved invoice.
create table if not exists public.finance_payment_requests (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references public.projects (id) on delete cascade,
  invoice_id           uuid not null references public.finance_invoices (id) on delete cascade,
  amount               numeric not null,
  priority             text not null default 'medium',   -- low | medium | high
  status               public.finance_payment_status not null default 'pending_director',
  notes                text,
  director_approved_by uuid references public.profiles (id),
  director_approved_at timestamptz,
  paid_by              uuid references public.profiles (id),
  paid_at              timestamptz,
  created_by           uuid references public.profiles (id) default auth.uid(),
  created_at           timestamptz not null default now()
);
create index if not exists finance_payment_requests_project_idx on public.finance_payment_requests (project_id);
create index if not exists finance_payment_requests_invoice_idx on public.finance_payment_requests (invoice_id);

-- The retention register: 5% held at invoice approval, due 12 months later.
create table if not exists public.finance_retention (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projects (id) on delete cascade,
  invoice_id          uuid not null references public.finance_invoices (id) on delete cascade,
  amount              numeric not null,
  due_date            date not null,                 -- approval date + 12 months
  status              public.finance_retention_status not null default 'held',
  early_requested_by  uuid references public.profiles (id),   -- Director asks to release early
  early_requested_at  timestamptz,
  early_approved_by   uuid references public.profiles (id),   -- MD approves early release
  early_approved_at   timestamptz,
  paid_by             uuid references public.profiles (id),
  paid_at             timestamptz,
  created_at          timestamptz not null default now()
);
create index if not exists finance_retention_project_idx on public.finance_retention (project_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. RLS (reads; writes via RPCs)
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.finance_invoices          enable row level security;
alter table public.finance_invoice_lines     enable row level security;
alter table public.finance_payment_requests  enable row level security;
alter table public.finance_retention         enable row level security;

drop policy if exists "finance_invoices_select" on public.finance_invoices;
create policy "finance_invoices_select" on public.finance_invoices
  for select using (public.has_project_permission(project_id, 'finance.invoice', 'read'));

drop policy if exists "finance_invoice_lines_select" on public.finance_invoice_lines;
create policy "finance_invoice_lines_select" on public.finance_invoice_lines
  for select using (exists (
    select 1 from public.finance_invoices i
    where i.id = invoice_id
      and public.has_project_permission(i.project_id, 'finance.invoice', 'read')
  ));

drop policy if exists "finance_payment_requests_select" on public.finance_payment_requests;
create policy "finance_payment_requests_select" on public.finance_payment_requests
  for select using (public.has_project_permission(project_id, 'finance.payment', 'read'));

drop policy if exists "finance_retention_select" on public.finance_retention;
create policy "finance_retention_select" on public.finance_retention
  for select using (public.has_project_permission(project_id, 'finance.retention', 'read'));

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Storage bucket for invoice documents
-- ═══════════════════════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public)
values ('finance-docs', 'finance-docs', false)
on conflict (id) do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Helpers
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.finance_invoice_project(p_invoice uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select project_id from public.finance_invoices where id = p_invoice;
$$;

-- The PO's total ordered value (Σ line amounts) — the cap invoices bill against.
create or replace function public.order_total_value(p_order uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0) from public.procurement_order_lines where order_id = p_order;
$$;

-- Base value already billed on a PO (non-rejected invoices).
create or replace function public.order_invoiced_base(p_order uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(base_value), 0)
  from public.finance_invoices
  where order_id = p_order and status <> 'rejected';
$$;

-- Whether an invoice is over the PO cap (cumulative non-rejected base > PO value).
create or replace function public.invoice_over_cap(p_invoice uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.order_invoiced_base(i.order_id) > public.order_total_value(i.order_id)
  from public.finance_invoices i where i.id = p_invoice;
$$;

-- Approved-advance still available to net against a vendor's invoice (gross advance
-- minus what's already been consumed).
create or replace function public.order_advance_remaining(p_order uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select case
    when (select advance_approved_at from public.procurement_orders where id = p_order) is null then 0
    else greatest(0,
      coalesce((select advance_requested from public.procurement_orders where id = p_order), 0)
      - coalesce((select advance_consumed  from public.procurement_orders where id = p_order), 0))
  end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Billing branches (finance.settings)
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.upsert_billing_branch(
  p_id uuid, p_name text, p_gstin text, p_address text
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.has_permission('finance.settings', 'manage') then
    raise exception 'Not authorized to manage billing branches';
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Enter a branch name'; end if;
  if p_id is null then
    insert into public.billing_branches (name, gstin, address)
    values (trim(p_name), nullif(trim(p_gstin), ''), nullif(trim(p_address), ''))
    returning id into v_id;
  else
    update public.billing_branches
       set name = trim(p_name), gstin = nullif(trim(p_gstin), ''), address = nullif(trim(p_address), '')
     where id = p_id returning id into v_id;
    if v_id is null then raise exception 'Branch not found'; end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.set_billing_branch_active(p_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('finance.settings', 'manage') then
    raise exception 'Not authorized to manage billing branches';
  end if;
  update public.billing_branches set active = p_active where id = p_id;
end;
$$;

create or replace function public.list_billing_branches(p_active_only boolean default false)
returns table (id uuid, name text, gstin text, address text, active boolean)
language sql stable security definer set search_path = public as $$
  select id, name, gstin, address, active
  from public.billing_branches
  where auth.uid() is not null and (not p_active_only or active)
  order by name;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. PO advance + terms (finance.advance)
-- ═══════════════════════════════════════════════════════════════════════════

-- Set the PO's fixed-contract window + billing branch (finance.advance: update).
create or replace function public.set_order_terms(
  p_order uuid, p_fixed boolean, p_start date, p_end date, p_branch uuid
)
returns void language plpgsql security definer set search_path = public as $$
declare v_project uuid;
begin
  v_project := public.procurement_order_project(p_order);
  if v_project is null then raise exception 'Order not found'; end if;
  if not public.has_project_permission(v_project, 'finance.advance', 'update') then
    raise exception 'Not authorized to set PO terms';
  end if;
  if p_fixed and (p_start is null or p_end is null) then
    raise exception 'A fixed contract needs both a start and end date';
  end if;
  update public.procurement_orders
     set fixed_contract = coalesce(p_fixed, false),
         contract_start = case when p_fixed then p_start else null end,
         contract_end   = case when p_fixed then p_end   else null end,
         billing_branch_id = p_branch
   where id = p_order;
end;
$$;

-- Request an advance on the PO (finance.advance: update — PM/procurement).
create or replace function public.request_po_advance(p_order uuid, p_amount numeric, p_tds_pct numeric)
returns void language plpgsql security definer set search_path = public as $$
declare v_project uuid;
begin
  v_project := public.procurement_order_project(p_order);
  if v_project is null then raise exception 'Order not found'; end if;
  if not public.has_project_permission(v_project, 'finance.advance', 'update') then
    raise exception 'Not authorized to request an advance';
  end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter an advance amount'; end if;
  if (select advance_approved_at from public.procurement_orders where id = p_order) is not null then
    raise exception 'The advance is already approved';
  end if;
  update public.procurement_orders
     set advance_requested = p_amount,
         advance_tds_pct   = coalesce(p_tds_pct, 0)
   where id = p_order;
end;
$$;

-- Project Director approves the advance (finance.advance: approve).
create or replace function public.approve_po_advance(p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_project uuid; v_amt numeric; v_tds numeric;
begin
  select project_id, advance_requested, advance_tds_pct
    into v_project, v_amt, v_tds
  from public.procurement_orders where id = p_order;
  if v_project is null then raise exception 'Order not found'; end if;
  if not public.has_project_permission(v_project, 'finance.advance', 'approve') then
    raise exception 'Not authorized to approve advances (Project Director)';
  end if;
  if coalesce(v_amt, 0) <= 0 then raise exception 'No advance has been requested'; end if;
  update public.procurement_orders
     set advance_approved_by = auth.uid(),
         advance_approved_at = now(),
         advance_payable = v_amt - v_amt * coalesce(v_tds, 0) / 100
   where id = p_order;
end;
$$;

-- Accounts records the advance as paid (finance.advance: issue).
create or replace function public.pay_po_advance(p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_project uuid; v_approved timestamptz;
begin
  select project_id, advance_approved_at into v_project, v_approved
  from public.procurement_orders where id = p_order;
  if v_project is null then raise exception 'Order not found'; end if;
  if not public.has_project_permission(v_project, 'finance.advance', 'issue') then
    raise exception 'Not authorized to pay advances (Accounts)';
  end if;
  if v_approved is null then raise exception 'The advance must be approved first'; end if;
  update public.procurement_orders
     set advance_paid_by = auth.uid(), advance_paid_at = now()
   where id = p_order;
end;
$$;

-- POs on a project with their advance + terms, for the Finance "POs & Advances" tab.
create or replace function public.list_project_finance_orders(p_project uuid)
returns table (
  id uuid, po_number text, vendor_id uuid, vendor_name text,
  status public.procurement_order_status, po_total numeric,
  acceptance_on_file boolean,
  fixed_contract boolean, contract_start date, contract_end date,
  billing_branch_id uuid, billing_branch_name text,
  advance_requested numeric, advance_tds_pct numeric, advance_payable numeric,
  advance_consumed numeric, advance_remaining numeric,
  advance_approved_at timestamptz, advance_paid_at timestamptz,
  can_set_terms boolean, can_approve_advance boolean, can_pay_advance boolean
)
language sql stable security definer set search_path = public as $$
  select o.id, o.po_number, o.vendor_id, v.name, o.status,
         public.order_total_value(o.id),
         o.acceptance_file is not null,
         o.fixed_contract, o.contract_start, o.contract_end,
         o.billing_branch_id, bb.name,
         o.advance_requested, o.advance_tds_pct, o.advance_payable,
         o.advance_consumed, public.order_advance_remaining(o.id),
         o.advance_approved_at, o.advance_paid_at,
         public.has_project_permission(o.project_id, 'finance.advance', 'update'),
         public.has_project_permission(o.project_id, 'finance.advance', 'approve'),
         public.has_project_permission(o.project_id, 'finance.advance', 'issue')
  from public.procurement_orders o
  join public.procurement_vendors v on v.id = o.vendor_id
  left join public.billing_branches bb on bb.id = o.billing_branch_id
  where o.project_id = p_project
    and o.status in ('issued', 'closed', 'amending')
    and public.has_project_permission(p_project, 'finance.advance', 'read')
  order by o.created_at desc;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. Invoices (finance.invoice)
-- ═══════════════════════════════════════════════════════════════════════════

-- PM enters a vendor invoice against a PO. Gates: PO issued · acceptance letter on
-- file · inside the contract window (if fixed) · not a duplicate · base within the
-- PO cap (unless a bypass is already recorded). p_lines = [{base,sgst,cgst,igst}].
create or replace function public.create_invoice(
  p_order uuid, p_vendor_invoice_no text, p_vendor_invoice_date date,
  p_due_date date, p_lines jsonb, p_file text, p_remarks text
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_project uuid; v_vendor uuid; v_ostatus public.procurement_order_status;
  v_accept text; v_fixed boolean; v_cstart date; v_cend date;
  v_base numeric := 0; v_gst numeric := 0; v_total numeric; v_seq int;
  v_invoice uuid; a jsonb; v_i int := 0; v_b numeric; v_s numeric; v_c numeric; v_ig numeric;
begin
  select project_id, vendor_id, status, acceptance_file, fixed_contract, contract_start, contract_end
    into v_project, v_vendor, v_ostatus, v_accept, v_fixed, v_cstart, v_cend
  from public.procurement_orders where id = p_order;
  if v_project is null then raise exception 'Purchase order not found'; end if;
  if not public.has_project_permission(v_project, 'finance.invoice', 'create') then
    raise exception 'Not authorized to enter invoices on this project';
  end if;
  if v_ostatus not in ('issued', 'closed', 'amending') then
    raise exception 'Invoices can only be raised against a released purchase order';
  end if;
  if v_accept is null then
    raise exception 'Upload the vendor''s acceptance letter on the purchase order before invoicing';
  end if;
  if coalesce(trim(p_vendor_invoice_no), '') = '' then raise exception 'Enter the vendor''s invoice number'; end if;
  if p_vendor_invoice_date is null then raise exception 'Enter the vendor''s invoice date'; end if;

  -- Fixed-contract window check.
  if v_fixed then
    if (v_cstart is not null and p_vendor_invoice_date < v_cstart)
       or (v_cend is not null and p_vendor_invoice_date > v_cend) then
      raise exception 'Invoice date % is outside the vendor''s contract period (% to %)',
        p_vendor_invoice_date, v_cstart, v_cend;
    end if;
  end if;

  -- Duplicate guard: same vendor + vendor invoice number, not rejected.
  if exists (
    select 1 from public.finance_invoices
    where vendor_id = v_vendor and lower(vendor_invoice_no) = lower(trim(p_vendor_invoice_no))
      and status <> 'rejected'
  ) then
    raise exception 'An invoice with number "%" already exists for this vendor', trim(p_vendor_invoice_no);
  end if;

  -- Tally the base + GST from the lines (at least one positive base required).
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one invoice line';
  end if;
  for a in select value from jsonb_array_elements(p_lines) loop
    v_b := coalesce((a->>'base')::numeric, 0);
    if v_b <= 0 then continue; end if;
    v_s := coalesce((a->>'sgst')::numeric, 0);
    v_c := coalesce((a->>'cgst')::numeric, 0);
    v_ig := coalesce((a->>'igst')::numeric, 0);
    v_base := v_base + v_b;
    v_gst  := v_gst + v_b * (v_s + v_c + v_ig) / 100;
  end loop;
  if v_base <= 0 then raise exception 'Enter a base value on at least one line'; end if;
  v_total := v_base + v_gst;

  -- Note: the PO cap (cumulative base ≤ PO value) is NOT blocked at entry. An
  -- over-cap invoice is created but flagged (see invoice_over_cap); Director approval
  -- is blocked until a Director/MD records an override (bypass_invoice_cap).

  select count(*) + 1 into v_seq from public.finance_invoices where project_id = v_project;
  insert into public.finance_invoices
    (project_id, order_id, vendor_id, invoice_no, vendor_invoice_no, vendor_invoice_date,
     due_date, base_value, gst_amount, amount_total, amount_payable, file_path, remarks)
  values
    (v_project, p_order, v_vendor, 'SM-INV-' || lpad(v_seq::text, 4, '0'),
     trim(p_vendor_invoice_no), p_vendor_invoice_date, p_due_date,
     v_base, v_gst, v_total, v_total, nullif(trim(p_file), ''), nullif(trim(p_remarks), ''))
  returning id into v_invoice;

  for a in select value from jsonb_array_elements(p_lines) loop
    v_b := coalesce((a->>'base')::numeric, 0);
    if v_b <= 0 then continue; end if;
    insert into public.finance_invoice_lines (invoice_id, base, sgst, cgst, igst, sort)
    values (v_invoice, v_b, coalesce((a->>'sgst')::numeric, 0),
            coalesce((a->>'cgst')::numeric, 0), coalesce((a->>'igst')::numeric, 0), v_i);
    v_i := v_i + 1;
  end loop;

  return v_invoice;
end;
$$;

-- Project Director approves an entered invoice → it goes to Accounts.
create or replace function public.director_approve_invoice(p_invoice uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_project uuid; v_status public.finance_invoice_status;
begin
  select project_id, status into v_project, v_status from public.finance_invoices where id = p_invoice;
  if v_project is null then raise exception 'Invoice not found'; end if;
  if not public.has_project_permission(v_project, 'finance.invoice', 'approve') then
    raise exception 'Not authorized to approve invoices (Project Director)';
  end if;
  if v_status <> 'pending_director' then raise exception 'This invoice is not awaiting director approval'; end if;
  if public.invoice_over_cap(p_invoice)
     and (select cap_bypass_at from public.finance_invoices where id = p_invoice) is null then
    raise exception 'This invoice is over the PO cap — a Director/MD must override it before approval';
  end if;
  update public.finance_invoices
     set status = 'pending_accounts', director_approved_by = auth.uid(), director_approved_at = now()
   where id = p_invoice;
end;
$$;

-- Senior PO-cap override (finance.invoice: manage — Director/MD). Records the bypass
-- so create/accounts steps won't block on the cap.
create or replace function public.bypass_invoice_cap(p_invoice uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_project uuid;
begin
  select project_id into v_project from public.finance_invoices where id = p_invoice;
  if v_project is null then raise exception 'Invoice not found'; end if;
  if not public.has_project_permission(v_project, 'finance.invoice', 'manage') then
    raise exception 'Not authorized to override the PO cap';
  end if;
  update public.finance_invoices set cap_bypass_by = auth.uid(), cap_bypass_at = now() where id = p_invoice;
end;
$$;

-- Accounts books the invoice: confirm/adjust the money math, deduct advance, hold
-- retention, land on amount payable. Books the base value against the budget (the
-- invoice becomes "approved"). p_lines lets Accounts adjust the GST breakdown.
create or replace function public.accounts_approve_invoice(
  p_invoice uuid, p_lines jsonb, p_other_charges numeric, p_tds_pct numeric,
  p_deduct_advance boolean, p_advance_amount numeric, p_hold_retention boolean, p_remarks text
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_project uuid; v_order uuid; v_status public.finance_invoice_status; v_bypass timestamptz;
  v_base numeric := 0; v_gst numeric := 0; v_total numeric; v_subtotal numeric;
  v_adv_rem numeric; v_deduct numeric := 0; v_after numeric; v_tds numeric; v_ret numeric := 0; v_payable numeric;
  a jsonb; v_b numeric; v_s numeric; v_c numeric; v_ig numeric; v_i int := 0;
begin
  select project_id, order_id, status, cap_bypass_at
    into v_project, v_order, v_status, v_bypass
  from public.finance_invoices where id = p_invoice;
  if v_project is null then raise exception 'Invoice not found'; end if;
  if not public.has_project_permission(v_project, 'finance.invoice', 'review') then
    raise exception 'Not authorized to book invoices (Accounts)';
  end if;
  if v_status <> 'pending_accounts' then raise exception 'This invoice is not awaiting accounts approval'; end if;

  -- Recompute base + GST from the (possibly adjusted) lines.
  if p_lines is not null and jsonb_array_length(p_lines) > 0 then
    delete from public.finance_invoice_lines where invoice_id = p_invoice;
    for a in select value from jsonb_array_elements(p_lines) loop
      v_b := coalesce((a->>'base')::numeric, 0);
      if v_b <= 0 then continue; end if;
      v_s := coalesce((a->>'sgst')::numeric, 0);
      v_c := coalesce((a->>'cgst')::numeric, 0);
      v_ig := coalesce((a->>'igst')::numeric, 0);
      v_base := v_base + v_b;
      v_gst  := v_gst + v_b * (v_s + v_c + v_ig) / 100;
      insert into public.finance_invoice_lines (invoice_id, base, sgst, cgst, igst, sort)
      values (p_invoice, v_b, v_s, v_c, v_ig, v_i);
      v_i := v_i + 1;
    end loop;
  else
    select coalesce(sum(base), 0), coalesce(sum(base * (sgst + cgst + igst) / 100), 0)
      into v_base, v_gst from public.finance_invoice_lines where invoice_id = p_invoice;
  end if;
  if v_base <= 0 then raise exception 'The invoice needs a base value'; end if;

  -- Re-check the PO cap unless a senior bypass is on file.
  if v_bypass is null then
    if (public.order_invoiced_base(v_order) - (
          select base_value from public.finance_invoices where id = p_invoice
        )) + v_base > public.order_total_value(v_order) then
      raise exception 'The adjusted base value exceeds the PO cap — apply a Director/MD override first';
    end if;
  end if;

  v_total    := v_base + v_gst;
  v_subtotal := v_total + coalesce(p_other_charges, 0);

  -- Advance deduction (capped at what's left on the PO advance).
  if coalesce(p_deduct_advance, false) then
    v_adv_rem := public.order_advance_remaining(v_order);
    v_deduct  := least(coalesce(p_advance_amount, 0), v_subtotal, v_adv_rem);
    if v_deduct < 0 then v_deduct := 0; end if;
  end if;

  v_after := greatest(0, v_subtotal - v_deduct);
  v_tds   := v_after * coalesce(p_tds_pct, 0) / 100;
  if coalesce(p_hold_retention, false) then
    v_ret := (v_after - v_tds) * 0.05;
  end if;
  v_payable := greatest(0, v_after - v_tds - v_ret);

  update public.finance_invoices set
    status = 'approved',
    base_value = v_base, gst_amount = v_gst, other_charges = coalesce(p_other_charges, 0),
    amount_total = v_subtotal,
    tds_pct = p_tds_pct, tds_amount = v_tds,
    advance_deducted = v_deduct,
    retention_held = coalesce(p_hold_retention, false), retention_amount = v_ret,
    amount_payable = v_payable,
    remarks = coalesce(nullif(trim(p_remarks), ''), remarks),
    accounts_approved_by = auth.uid(), accounts_approved_at = now()
  where id = p_invoice;

  -- Consume the advance against the PO.
  if v_deduct > 0 then
    update public.procurement_orders
       set advance_consumed = coalesce(advance_consumed, 0) + v_deduct
     where id = v_order;
  end if;

  -- Open a retention register row, due 12 months out.
  if v_ret > 0 then
    insert into public.finance_retention (project_id, invoice_id, amount, due_date)
    values (v_project, p_invoice, v_ret, (current_date + interval '12 months')::date);
  end if;
end;
$$;

create or replace function public.reject_invoice(p_invoice uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_project uuid;
begin
  select project_id into v_project from public.finance_invoices where id = p_invoice;
  if v_project is null then raise exception 'Invoice not found'; end if;
  -- A director (approve) or accounts (review) reviewer may reject.
  if not (public.has_project_permission(v_project, 'finance.invoice', 'approve')
          or public.has_project_permission(v_project, 'finance.invoice', 'review')) then
    raise exception 'Not authorized to reject this invoice';
  end if;
  update public.finance_invoices set status = 'rejected' where id = p_invoice
    and status in ('pending_director', 'pending_accounts');
end;
$$;

create or replace function public.delete_invoice(p_invoice uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_project uuid; v_status public.finance_invoice_status;
begin
  select project_id, status into v_project, v_status from public.finance_invoices where id = p_invoice;
  if v_project is null then raise exception 'Invoice not found'; end if;
  if not public.has_project_permission(v_project, 'finance.invoice', 'delete') then
    raise exception 'Not authorized to delete invoices';
  end if;
  if v_status = 'approved' then raise exception 'An approved invoice cannot be deleted'; end if;
  delete from public.finance_invoices where id = p_invoice;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. Payment requests (finance.payment)
-- ═══════════════════════════════════════════════════════════════════════════

-- Remaining payable on an approved invoice that can still be requested.
create or replace function public.invoice_remaining(p_invoice uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select greatest(0, coalesce(amount_payable, 0) - coalesce(requested_amount, 0))
  from public.finance_invoices where id = p_invoice;
$$;

create or replace function public.raise_payment_request(
  p_invoice uuid, p_amount numeric, p_priority text, p_notes text
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_project uuid; v_status public.finance_invoice_status; v_rem numeric; v_id uuid;
begin
  select project_id, status into v_project, v_status from public.finance_invoices where id = p_invoice;
  if v_project is null then raise exception 'Invoice not found'; end if;
  if not public.has_project_permission(v_project, 'finance.payment', 'create') then
    raise exception 'Not authorized to raise payment requests';
  end if;
  if v_status <> 'approved' then raise exception 'Only an approved invoice can be paid'; end if;
  v_rem := public.invoice_remaining(p_invoice);
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter an amount to pay'; end if;
  if p_amount > v_rem then raise exception 'That is more than the % remaining on this invoice', v_rem; end if;

  insert into public.finance_payment_requests (project_id, invoice_id, amount, priority, notes)
  values (v_project, p_invoice, p_amount,
          case when lower(coalesce(p_priority, '')) in ('low','medium','high') then lower(p_priority) else 'medium' end,
          nullif(trim(p_notes), ''))
  returning id into v_id;

  update public.finance_invoices
     set requested_amount = coalesce(requested_amount, 0) + p_amount
   where id = p_invoice;
  return v_id;
end;
$$;

create or replace function public.approve_payment_request(p_req uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_project uuid; v_status public.finance_payment_status;
begin
  select project_id, status into v_project, v_status from public.finance_payment_requests where id = p_req;
  if v_project is null then raise exception 'Request not found'; end if;
  if not public.has_project_permission(v_project, 'finance.payment', 'approve') then
    raise exception 'Not authorized to approve payment requests (Project Director)';
  end if;
  if v_status <> 'pending_director' then raise exception 'This request is not awaiting approval'; end if;
  update public.finance_payment_requests
     set status = 'approved', director_approved_by = auth.uid(), director_approved_at = now()
   where id = p_req;
end;
$$;

create or replace function public.mark_payment_paid(p_req uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_project uuid; v_status public.finance_payment_status;
begin
  select project_id, status into v_project, v_status from public.finance_payment_requests where id = p_req;
  if v_project is null then raise exception 'Request not found'; end if;
  if not public.has_project_permission(v_project, 'finance.payment', 'issue') then
    raise exception 'Not authorized to mark payments paid (Accounts)';
  end if;
  if v_status <> 'approved' then raise exception 'The request must be approved before it is paid'; end if;
  update public.finance_payment_requests
     set status = 'paid', paid_by = auth.uid(), paid_at = now()
   where id = p_req;
end;
$$;

create or replace function public.reject_payment_request(p_req uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_project uuid; v_status public.finance_payment_status; v_inv uuid; v_amt numeric;
begin
  select project_id, status, invoice_id, amount
    into v_project, v_status, v_inv, v_amt
  from public.finance_payment_requests where id = p_req;
  if v_project is null then raise exception 'Request not found'; end if;
  if not public.has_project_permission(v_project, 'finance.payment', 'approve') then
    raise exception 'Not authorized to reject payment requests';
  end if;
  if v_status not in ('pending_director', 'approved') then raise exception 'This request cannot be rejected now'; end if;
  update public.finance_payment_requests set status = 'rejected' where id = p_req;
  -- Free the amount back on the invoice.
  update public.finance_invoices set requested_amount = greatest(0, coalesce(requested_amount, 0) - v_amt)
   where id = v_inv;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. Retention (finance.retention)
-- ═══════════════════════════════════════════════════════════════════════════

-- Accounts pays a matured (or early-released) retention.
create or replace function public.mark_retention_paid(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_project uuid; v_status public.finance_retention_status; v_due date; v_early timestamptz;
begin
  select project_id, status, due_date, early_approved_at
    into v_project, v_status, v_due, v_early
  from public.finance_retention where id = p_id;
  if v_project is null then raise exception 'Retention entry not found'; end if;
  if not public.has_project_permission(v_project, 'finance.retention', 'issue') then
    raise exception 'Not authorized to pay retention (Accounts)';
  end if;
  if v_status <> 'held' then raise exception 'This retention is already paid'; end if;
  if v_due > current_date and v_early is null then
    raise exception 'This retention is not due until % (needs an approved early release)', v_due;
  end if;
  update public.finance_retention set status = 'paid', paid_by = auth.uid(), paid_at = now() where id = p_id;
end;
$$;

-- A Director requests early release of held retention (finance.retention: update).
create or replace function public.request_early_retention(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_project uuid; v_status public.finance_retention_status;
begin
  select project_id, status into v_project, v_status from public.finance_retention where id = p_id;
  if v_project is null then raise exception 'Retention entry not found'; end if;
  if not public.has_project_permission(v_project, 'finance.retention', 'update') then
    raise exception 'Not authorized to request an early release';
  end if;
  if v_status <> 'held' then raise exception 'This retention is already paid'; end if;
  update public.finance_retention
     set early_requested_by = auth.uid(), early_requested_at = now()
   where id = p_id;
end;
$$;

-- The MD approves the early release (finance.retention: manage). After this Accounts
-- may pay it before the 12-month due date.
create or replace function public.approve_early_retention(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_project uuid; v_req timestamptz;
begin
  select project_id, early_requested_at into v_project, v_req from public.finance_retention where id = p_id;
  if v_project is null then raise exception 'Retention entry not found'; end if;
  if not public.has_project_permission(v_project, 'finance.retention', 'manage') then
    raise exception 'Not authorized to approve an early release (MD)';
  end if;
  if v_req is null then raise exception 'No early release has been requested'; end if;
  update public.finance_retention
     set early_approved_by = auth.uid(), early_approved_at = now()
   where id = p_id;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 11. Read RPCs (lists + detail)
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.list_project_invoices(p_project uuid)
returns table (
  id uuid, invoice_no text, vendor_invoice_no text, vendor_name text,
  po_number text, vendor_invoice_date date, due_date date,
  status public.finance_invoice_status,
  base_value numeric, amount_total numeric, amount_payable numeric,
  requested_amount numeric, remaining numeric,
  days_due int, cap_bypassed boolean, over_cap boolean,
  can_approve boolean, can_book boolean, can_manage boolean,
  can_raise_payment boolean, can_delete boolean
)
language sql stable security definer set search_path = public as $$
  select i.id, i.invoice_no, i.vendor_invoice_no, v.name, o.po_number,
         i.vendor_invoice_date, i.due_date, i.status,
         i.base_value, i.amount_total, i.amount_payable,
         i.requested_amount, greatest(0, i.amount_payable - i.requested_amount),
         case when i.status = 'approved'
              then (current_date - i.accounts_approved_at::date) else null end,
         i.cap_bypass_at is not null, public.invoice_over_cap(i.id),
         public.has_project_permission(i.project_id, 'finance.invoice', 'approve'),
         public.has_project_permission(i.project_id, 'finance.invoice', 'review'),
         public.has_project_permission(i.project_id, 'finance.invoice', 'manage'),
         public.has_project_permission(i.project_id, 'finance.payment', 'create'),
         public.has_project_permission(i.project_id, 'finance.invoice', 'delete')
  from public.finance_invoices i
  join public.procurement_vendors v on v.id = i.vendor_id
  join public.procurement_orders o on o.id = i.order_id
  where i.project_id = p_project
    and public.has_project_permission(p_project, 'finance.invoice', 'read')
  order by i.created_at desc;
$$;

create or replace function public.get_invoice(p_invoice uuid)
returns table (
  id uuid, invoice_no text, vendor_invoice_no text, vendor_invoice_date date, due_date date,
  vendor_name text, po_number text, order_id uuid, status public.finance_invoice_status,
  base_value numeric, gst_amount numeric, other_charges numeric, amount_total numeric,
  tds_pct numeric, tds_amount numeric, advance_deducted numeric,
  retention_held boolean, retention_amount numeric, amount_payable numeric,
  requested_amount numeric, remaining numeric, file_path text, remarks text,
  advance_remaining numeric, cap_bypassed boolean, over_cap boolean,
  director_approved_name text, accounts_approved_name text,
  can_approve boolean, can_book boolean, can_manage boolean
)
language sql stable security definer set search_path = public as $$
  select i.id, i.invoice_no, i.vendor_invoice_no, i.vendor_invoice_date, i.due_date,
         v.name, o.po_number, i.order_id, i.status,
         i.base_value, i.gst_amount, i.other_charges, i.amount_total,
         i.tds_pct, i.tds_amount, i.advance_deducted,
         i.retention_held, i.retention_amount, i.amount_payable,
         i.requested_amount, greatest(0, i.amount_payable - i.requested_amount),
         i.file_path, i.remarks,
         public.order_advance_remaining(i.order_id), i.cap_bypass_at is not null,
         public.invoice_over_cap(i.id),
         coalesce(dp.full_name, dp.email), coalesce(ap.full_name, ap.email),
         public.has_project_permission(i.project_id, 'finance.invoice', 'approve'),
         public.has_project_permission(i.project_id, 'finance.invoice', 'review'),
         public.has_project_permission(i.project_id, 'finance.invoice', 'manage')
  from public.finance_invoices i
  join public.procurement_vendors v on v.id = i.vendor_id
  join public.procurement_orders o on o.id = i.order_id
  left join public.profiles dp on dp.id = i.director_approved_by
  left join public.profiles ap on ap.id = i.accounts_approved_by
  where i.id = p_invoice
    and public.has_project_permission(i.project_id, 'finance.invoice', 'read');
$$;

create or replace function public.get_invoice_lines(p_invoice uuid)
returns table (id uuid, base numeric, sgst numeric, cgst numeric, igst numeric)
language sql stable security definer set search_path = public as $$
  select l.id, l.base, l.sgst, l.cgst, l.igst
  from public.finance_invoice_lines l
  join public.finance_invoices i on i.id = l.invoice_id
  where l.invoice_id = p_invoice
    and public.has_project_permission(i.project_id, 'finance.invoice', 'read')
  order by l.sort;
$$;

create or replace function public.list_project_payments(p_project uuid)
returns table (
  id uuid, invoice_no text, vendor_name text, amount numeric, priority text,
  status public.finance_payment_status, notes text, created_at timestamptz,
  can_approve boolean, can_pay boolean
)
language sql stable security definer set search_path = public as $$
  select pr.id, i.invoice_no, v.name, pr.amount, pr.priority, pr.status, pr.notes, pr.created_at,
         public.has_project_permission(pr.project_id, 'finance.payment', 'approve'),
         public.has_project_permission(pr.project_id, 'finance.payment', 'issue')
  from public.finance_payment_requests pr
  join public.finance_invoices i on i.id = pr.invoice_id
  join public.procurement_vendors v on v.id = i.vendor_id
  where pr.project_id = p_project
    and public.has_project_permission(p_project, 'finance.payment', 'read')
  order by case pr.priority when 'high' then 0 when 'medium' then 1 else 2 end, pr.created_at desc;
$$;

create or replace function public.list_project_retention(p_project uuid)
returns table (
  id uuid, invoice_no text, vendor_name text, amount numeric, due_date date,
  status public.finance_retention_status, is_due boolean,
  early_requested boolean, early_approved boolean,
  can_pay boolean, can_request_early boolean, can_approve_early boolean
)
language sql stable security definer set search_path = public as $$
  select rt.id, i.invoice_no, v.name, rt.amount, rt.due_date, rt.status,
         (rt.due_date <= current_date or rt.early_approved_at is not null),
         rt.early_requested_at is not null, rt.early_approved_at is not null,
         public.has_project_permission(rt.project_id, 'finance.retention', 'issue'),
         public.has_project_permission(rt.project_id, 'finance.retention', 'update'),
         public.has_project_permission(rt.project_id, 'finance.retention', 'manage')
  from public.finance_retention rt
  join public.finance_invoices i on i.id = rt.invoice_id
  join public.procurement_vendors v on v.id = i.vendor_id
  where rt.project_id = p_project
    and public.has_project_permission(p_project, 'finance.retention', 'read')
  order by rt.due_date;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 12. Company-wide reports (Finance dashboard) + budget booking
-- ═══════════════════════════════════════════════════════════════════════════

-- The projects the caller can see finance for (all-projects visibility → every one).
create or replace function public.list_finance_projects()
returns table (id uuid, name text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name from public.projects p
  where public.has_project_permission(p.id, 'finance.invoice', 'read')
  order by p.name;
$$;

-- Headline totals across every project the caller can see.
create or replace function public.finance_summary()
returns table (
  total_owed numeric,          -- approved − paid, across invoices
  paid_this_month numeric,     -- payments marked paid in the current month
  advances_unpaid numeric,     -- approved advances not yet paid
  retention_held numeric       -- retention still held
)
language sql stable security definer set search_path = public as $$
  select
    coalesce((
      select sum(i.amount_payable)
      from public.finance_invoices i
      where i.status = 'approved'
        and public.has_project_permission(i.project_id, 'finance.invoice', 'read')
    ), 0)
    - coalesce((
      select sum(pr.amount) from public.finance_payment_requests pr
      where pr.status = 'paid'
        and public.has_project_permission(pr.project_id, 'finance.payment', 'read')
    ), 0),
    coalesce((
      select sum(pr.amount) from public.finance_payment_requests pr
      where pr.status = 'paid' and date_trunc('month', pr.paid_at) = date_trunc('month', now())
        and public.has_project_permission(pr.project_id, 'finance.payment', 'read')
    ), 0),
    coalesce((
      select sum(o.advance_payable) from public.procurement_orders o
      where o.advance_approved_at is not null and o.advance_paid_at is null
        and public.has_project_permission(o.project_id, 'finance.advance', 'read')
    ), 0),
    coalesce((
      select sum(rt.amount) from public.finance_retention rt
      where rt.status = 'held'
        and public.has_project_permission(rt.project_id, 'finance.retention', 'read')
    ), 0);
$$;

-- Per-vendor outstanding statement (invoiced / paid / retention held / still owed).
create or replace function public.vendor_outstanding_statement()
returns table (
  vendor_id uuid, vendor_name text,
  invoiced numeric, paid numeric, retention_held numeric, outstanding numeric
)
language sql stable security definer set search_path = public as $$
  with inv as (
    select i.vendor_id, sum(i.amount_payable) as payable
    from public.finance_invoices i
    where i.status = 'approved'
      and public.has_project_permission(i.project_id, 'finance.invoice', 'read')
    group by i.vendor_id
  ),
  pay as (
    select i.vendor_id, sum(pr.amount) as paid
    from public.finance_payment_requests pr
    join public.finance_invoices i on i.id = pr.invoice_id
    where pr.status = 'paid'
      and public.has_project_permission(pr.project_id, 'finance.payment', 'read')
    group by i.vendor_id
  ),
  ret as (
    select i.vendor_id, sum(rt.amount) as held
    from public.finance_retention rt
    join public.finance_invoices i on i.id = rt.invoice_id
    where rt.status = 'held'
      and public.has_project_permission(rt.project_id, 'finance.retention', 'read')
    group by i.vendor_id
  )
  select v.id, v.name,
         coalesce(inv.payable, 0), coalesce(pay.paid, 0), coalesce(ret.held, 0),
         coalesce(inv.payable, 0) - coalesce(pay.paid, 0)
  from public.procurement_vendors v
  join inv on inv.vendor_id = v.id
  left join pay on pay.vendor_id = v.id
  left join ret on ret.vendor_id = v.id
  order by (coalesce(inv.payable, 0) - coalesce(pay.paid, 0)) desc;
$$;

-- Approved invoices with the days-due ageing clock (for the report + Tally export).
create or replace function public.finance_invoice_ageing()
returns table (
  invoice_no text, vendor_name text, project_name text,
  base_value numeric, gst_amount numeric, tds_amount numeric,
  amount_payable numeric, paid numeric, outstanding numeric,
  approved_on date, due_date date, days_due int
)
language sql stable security definer set search_path = public as $$
  select i.invoice_no, v.name, p.name,
         i.base_value, i.gst_amount, i.tds_amount, i.amount_payable,
         coalesce((select sum(pr.amount) from public.finance_payment_requests pr
                   where pr.invoice_id = i.id and pr.status = 'paid'), 0),
         i.amount_payable - coalesce((select sum(pr.amount) from public.finance_payment_requests pr
                   where pr.invoice_id = i.id and pr.status = 'paid'), 0),
         i.accounts_approved_at::date, i.due_date,
         (current_date - i.accounts_approved_at::date)
  from public.finance_invoices i
  join public.procurement_vendors v on v.id = i.vendor_id
  join public.projects p on p.id = i.project_id
  where i.status = 'approved'
    and public.has_project_permission(i.project_id, 'finance.invoice', 'read')
  order by (current_date - i.accounts_approved_at::date) desc;
$$;

-- Budget vs invoices-booked (base value of approved invoices) — the number the
-- business tracks. Gated by finance.invoice:read on the project.
create or replace function public.project_invoices_booked(p_project uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((
    select sum(base_value) from public.finance_invoices
    where project_id = p_project and status = 'approved'
  ), 0)
  where public.has_project_permission(p_project, 'finance.invoice', 'read');
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 13. Seed role grants
-- ═══════════════════════════════════════════════════════════════════════════

-- Finance Head + Accounts Head: full run of the finance desk.
insert into public.role_permissions (role_id, resource, action)
select r.id, x.resource, x.action::public.app_action
from public.roles r
cross join (values
  ('finance.invoice','read'), ('finance.invoice','review'), ('finance.invoice','delete'),
  ('finance.payment','read'), ('finance.payment','issue'),
  ('finance.retention','read'), ('finance.retention','issue'), ('finance.retention','update'),
  ('finance.advance','read'), ('finance.advance','issue'), ('finance.advance','update'),
  ('finance.settings','read'), ('finance.settings','manage'),
  ('project','read')
) as x(resource, action)
where r.key in ('finance_head', 'accounts_head')
on conflict do nothing;

-- Accounts Team: book invoices, pay payments/retention/advances.
insert into public.role_permissions (role_id, resource, action)
select r.id, x.resource, x.action::public.app_action
from public.roles r
cross join (values
  ('finance.invoice','read'), ('finance.invoice','review'),
  ('finance.payment','read'), ('finance.payment','issue'),
  ('finance.retention','read'), ('finance.retention','issue'),
  ('finance.advance','read'), ('finance.advance','issue'),
  ('finance.settings','read'),
  ('project','read')
) as x(resource, action)
where r.key = 'accounts_member'
on conflict do nothing;

-- Billing Team: manage settings (branches + petty-cash categories come in 0061);
-- can see the finance desk.
insert into public.role_permissions (role_id, resource, action)
select r.id, x.resource, x.action::public.app_action
from public.roles r
cross join (values
  ('finance.invoice','read'), ('finance.payment','read'),
  ('finance.retention','read'), ('finance.advance','read'),
  ('finance.settings','read'), ('finance.settings','manage'),
  ('project','read')
) as x(resource, action)
where r.key = 'billing_member'
on conflict do nothing;

-- Project Manager: enter invoices, raise payment requests, request advances + set terms.
insert into public.role_permissions (role_id, resource, action)
select r.id, x.resource, x.action::public.app_action
from public.roles r
cross join (values
  ('finance.invoice','read'), ('finance.invoice','create'),
  ('finance.payment','read'), ('finance.payment','create'),
  ('finance.retention','read'),
  ('finance.advance','read'), ('finance.advance','update')
) as x(resource, action)
where r.key = 'pm_project_manager'
on conflict do nothing;

-- Project Director: approve invoices (+ PO-cap override), approve payments, approve
-- advances, request early retention release.
insert into public.role_permissions (role_id, resource, action)
select r.id, x.resource, x.action::public.app_action
from public.roles r
cross join (values
  ('finance.invoice','read'), ('finance.invoice','approve'), ('finance.invoice','manage'),
  ('finance.payment','read'), ('finance.payment','approve'),
  ('finance.retention','read'), ('finance.retention','update'),
  ('finance.advance','read'), ('finance.advance','approve'),
  ('project','read')
) as x(resource, action)
where r.key = 'pm_director'
on conflict do nothing;
