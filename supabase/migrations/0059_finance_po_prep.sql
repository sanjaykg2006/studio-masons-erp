-- Studio-Masons ERP — Finance prep: extend Procurement POs for the Finance module
-- Run AFTER 0058_task_pause.sql.
--
-- WHAT THIS ADDS  (see docs/finance-module-plan.md §5, §9)
--   The Finance module (next migration) sits on top of Procurement's purchase
--   orders. Vendor invoices need three things the PO doesn't track yet:
--     • ADVANCE — an amount paid to the vendor up front, approved on the PO by the
--       Project Director (with its own TDS), paid by Accounts, then gradually
--       "consumed" as invoices come in. One advance per PO.
--     • FIXED CONTRACT WINDOW — for fixed-term vendors, an invoice is only valid if
--       its date falls between contract_start and contract_end.
--     • BILLING BRANCH — which Studio-Masons GST registration the bill is raised
--       from (a dynamic, admin-managed list).
--
--   This migration is pure SCHEMA PREP: the columns, the billing-branches table, and
--   its read policy. All the finance LOGIC (approve/pay advance, manage branches, and
--   the setters) lives in 0060 with the rest of Finance, gated by the finance verbs.

-- 1. Billing branches (the company's GST registrations) -----------------------
-- A small, dynamic list managed by Finance (write RPCs in 0060). Readable by any
-- signed-in user so it can be picked on a PO — it's just a list of GST numbers,
-- not sensitive data.
create table if not exists public.billing_branches (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  gstin      text,
  address    text,
  active     boolean not null default true,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now()
);

alter table public.billing_branches enable row level security;

drop policy if exists "billing_branches_select" on public.billing_branches;
create policy "billing_branches_select" on public.billing_branches
  for select using (auth.uid() is not null);

-- 2. Extend the purchase order -----------------------------------------------
alter table public.procurement_orders
  -- Advance stage (approved on the PO, paid by Accounts, consumed against invoices).
  add column if not exists advance_requested   numeric,
  add column if not exists advance_tds_pct      numeric,
  add column if not exists advance_payable       numeric,   -- requested − its TDS, set at approval
  add column if not exists advance_approved_by   uuid references public.profiles (id),
  add column if not exists advance_approved_at   timestamptz,
  add column if not exists advance_paid_by        uuid references public.profiles (id),
  add column if not exists advance_paid_at        timestamptz,
  add column if not exists advance_consumed       numeric not null default 0,
  -- Fixed contract window — invoices for this vendor must fall inside it.
  add column if not exists fixed_contract          boolean not null default false,
  add column if not exists contract_start          date,
  add column if not exists contract_end            date,
  -- Which GST branch the bill is raised from.
  add column if not exists billing_branch_id       uuid references public.billing_branches (id);

create index if not exists procurement_orders_billing_branch_idx
  on public.procurement_orders (billing_branch_id);
