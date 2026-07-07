-- Studio-Masons ERP — Petty Cash (company-wide, any employee)
-- Run AFTER 0060_finance.sql.
--
-- WHAT THIS ADDS  (see docs/finance-module-plan.md §7)
--   A standalone module ANY employee can use to log a small spend and claim/settle
--   it. Unlike the rest of Finance it is NOT project-gated to create — every signed-in
--   employee may log an entry (optionally tagged to a project). It then runs a fixed
--   three-step approval chain regardless of amount:
--       log  →  Billing approves  →  MD approves  →  Accounts pays.
--   An entry is visible to the person who logged it plus the Billing and Accounts
--   teams (and the MD). Categories are a fixed list the Billing team manages.
--   Petty cash is tracked SEPARATELY — it does not touch any project budget.
--
--   Verbs (resource `pettycash.entry`): read = see EVERYONE's entries (Billing /
--   Accounts / MD); approve = Billing; manage = MD; issue = Accounts pays.
--   Creating an entry is ungated (any authenticated employee). `pettycash.category`:
--   manage = Billing edits the category list.

-- 1. Register the resources (to Finance, whose roles approve/pay/manage them) ----
insert into public.department_modules (department_id, module_id)
select d.id, m.module_id
from public.departments d
cross join (values ('pettycash.entry'), ('pettycash.category')) as m(module_id)
where d.key = 'finance'
on conflict do nothing;

insert into public.module_settings (module_id, is_general) values
  ('pettycash.entry', false),
  ('pettycash.category', false)
on conflict (module_id) do nothing;

-- 2. Vocabulary + tables ------------------------------------------------------
do $$ begin
  create type public.pettycash_status as enum
    ('pending_billing', 'pending_md', 'pending_accounts', 'paid', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.pettycash_kind as enum ('reimbursement', 'float');
exception when duplicate_object then null; end $$;

-- The category list (Travel, Food, Materials, …), managed by Billing.
create table if not exists public.pettycash_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.pettycash_entries (
  id            uuid primary key default gen_random_uuid(),
  created_by    uuid not null references public.profiles (id) default auth.uid(),
  project_id    uuid references public.projects (id) on delete set null,   -- optional
  category_id   uuid references public.pettycash_categories (id),
  kind          public.pettycash_kind not null default 'reimbursement',
  amount        numeric not null check (amount > 0),
  description   text,
  spent_on      date not null default current_date,
  file_path     text,                                          -- voucher document
  status        public.pettycash_status not null default 'pending_billing',
  billing_by    uuid references public.profiles (id),
  billing_at    timestamptz,
  md_by         uuid references public.profiles (id),
  md_at         timestamptz,
  paid_by       uuid references public.profiles (id),
  paid_at       timestamptz,
  rejected_by   uuid references public.profiles (id),
  rejected_at   timestamptz,
  reject_reason text,
  created_at    timestamptz not null default now()
);
create index if not exists pettycash_entries_creator_idx on public.pettycash_entries (created_by);
create index if not exists pettycash_entries_status_idx  on public.pettycash_entries (status);

-- 3. RLS ----------------------------------------------------------------------
alter table public.pettycash_categories enable row level security;
alter table public.pettycash_entries    enable row level security;

-- Categories: any signed-in employee may read them (to pick one).
drop policy if exists "pettycash_categories_select" on public.pettycash_categories;
create policy "pettycash_categories_select" on public.pettycash_categories
  for select using (auth.uid() is not null);

-- Entries: the person who logged it sees their own; Billing (approve), Accounts
-- (issue) and the MD (manage) see everyone's.
drop policy if exists "pettycash_entries_select" on public.pettycash_entries;
create policy "pettycash_entries_select" on public.pettycash_entries
  for select using (
    created_by = auth.uid()
    or public.has_permission('pettycash.entry', 'approve')
    or public.has_permission('pettycash.entry', 'issue')
    or public.has_permission('pettycash.entry', 'manage')
  );

-- 4. Category management (pettycash.category: manage — Billing) ----------------
create or replace function public.upsert_pettycash_category(p_id uuid, p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.has_permission('pettycash.category', 'manage') then
    raise exception 'Not authorized to manage petty-cash categories';
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Enter a category name'; end if;
  if p_id is null then
    insert into public.pettycash_categories (name) values (trim(p_name)) returning id into v_id;
  else
    update public.pettycash_categories set name = trim(p_name) where id = p_id returning id into v_id;
    if v_id is null then raise exception 'Category not found'; end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.set_pettycash_category_active(p_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('pettycash.category', 'manage') then
    raise exception 'Not authorized to manage petty-cash categories';
  end if;
  update public.pettycash_categories set active = p_active where id = p_id;
end;
$$;

create or replace function public.list_pettycash_categories(p_active_only boolean default false)
returns table (id uuid, name text, active boolean)
language sql stable security definer set search_path = public as $$
  select id, name, active from public.pettycash_categories
  where auth.uid() is not null and (not p_active_only or active)
  order by name;
$$;

-- 5. Entry lifecycle ----------------------------------------------------------

-- Any authenticated employee logs a spend.
create or replace function public.create_pettycash(
  p_project uuid, p_category uuid, p_kind text, p_amount numeric,
  p_description text, p_spent_on date, p_file text
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to log petty cash'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter an amount'; end if;
  insert into public.pettycash_entries
    (project_id, category_id, kind, amount, description, spent_on, file_path)
  values (p_project, p_category,
          case when lower(coalesce(p_kind, '')) = 'float' then 'float' else 'reimbursement' end::public.pettycash_kind,
          p_amount, nullif(trim(p_description), ''), coalesce(p_spent_on, current_date), nullif(trim(p_file), ''))
  returning id into v_id;
  return v_id;
end;
$$;

-- Billing approves (pettycash.entry: approve).
create or replace function public.billing_approve_pettycash(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_status public.pettycash_status;
begin
  if not public.has_permission('pettycash.entry', 'approve') then
    raise exception 'Not authorized to approve petty cash (Billing)';
  end if;
  select status into v_status from public.pettycash_entries where id = p_id;
  if v_status is null then raise exception 'Entry not found'; end if;
  if v_status <> 'pending_billing' then raise exception 'This entry is not awaiting Billing approval'; end if;
  update public.pettycash_entries
     set status = 'pending_md', billing_by = auth.uid(), billing_at = now()
   where id = p_id;
end;
$$;

-- MD approves (pettycash.entry: manage).
create or replace function public.md_approve_pettycash(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_status public.pettycash_status;
begin
  if not public.has_permission('pettycash.entry', 'manage') then
    raise exception 'Not authorized to approve petty cash (MD)';
  end if;
  select status into v_status from public.pettycash_entries where id = p_id;
  if v_status is null then raise exception 'Entry not found'; end if;
  if v_status <> 'pending_md' then raise exception 'This entry is not awaiting MD approval'; end if;
  update public.pettycash_entries
     set status = 'pending_accounts', md_by = auth.uid(), md_at = now()
   where id = p_id;
end;
$$;

-- Accounts pays (pettycash.entry: issue).
create or replace function public.pay_pettycash(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_status public.pettycash_status;
begin
  if not public.has_permission('pettycash.entry', 'issue') then
    raise exception 'Not authorized to pay petty cash (Accounts)';
  end if;
  select status into v_status from public.pettycash_entries where id = p_id;
  if v_status is null then raise exception 'Entry not found'; end if;
  if v_status <> 'pending_accounts' then raise exception 'This entry is not ready to pay'; end if;
  update public.pettycash_entries
     set status = 'paid', paid_by = auth.uid(), paid_at = now()
   where id = p_id;
end;
$$;

-- Any approver in the chain may reject.
create or replace function public.reject_pettycash(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.has_permission('pettycash.entry', 'approve')
          or public.has_permission('pettycash.entry', 'manage')
          or public.has_permission('pettycash.entry', 'issue')) then
    raise exception 'Not authorized to reject petty cash';
  end if;
  update public.pettycash_entries
     set status = 'rejected', rejected_by = auth.uid(), rejected_at = now(),
         reject_reason = nullif(trim(p_reason), '')
   where id = p_id and status in ('pending_billing', 'pending_md', 'pending_accounts');
end;
$$;

-- The person who logged an entry may delete it while it's still pending Billing.
create or replace function public.delete_pettycash(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_by uuid; v_status public.pettycash_status;
begin
  select created_by, status into v_by, v_status from public.pettycash_entries where id = p_id;
  if v_by is null then raise exception 'Entry not found'; end if;
  if v_by <> auth.uid() then raise exception 'Only the person who logged it can remove it'; end if;
  if v_status <> 'pending_billing' then raise exception 'It is already in approval and cannot be removed'; end if;
  delete from public.pettycash_entries where id = p_id;
end;
$$;

-- 6. Read RPC -----------------------------------------------------------------
-- Own entries for a normal employee; everyone's for Billing / Accounts / MD.
create or replace function public.list_pettycash_entries()
returns table (
  id uuid, created_by uuid, created_name text, project_id uuid, project_name text,
  category_name text, kind public.pettycash_kind, amount numeric, description text,
  spent_on date, file_path text, status public.pettycash_status,
  reject_reason text, created_at timestamptz, mine boolean,
  can_billing boolean, can_md boolean, can_pay boolean, can_reject boolean
)
language sql stable security definer set search_path = public as $$
  select e.id, e.created_by, coalesce(cp.full_name, cp.email), e.project_id, p.name,
         c.name, e.kind, e.amount, e.description, e.spent_on, e.file_path, e.status,
         e.reject_reason, e.created_at, e.created_by = auth.uid(),
         public.has_permission('pettycash.entry', 'approve'),
         public.has_permission('pettycash.entry', 'manage'),
         public.has_permission('pettycash.entry', 'issue'),
         (public.has_permission('pettycash.entry', 'approve')
          or public.has_permission('pettycash.entry', 'manage')
          or public.has_permission('pettycash.entry', 'issue'))
  from public.pettycash_entries e
  left join public.profiles cp on cp.id = e.created_by
  left join public.projects p on p.id = e.project_id
  left join public.pettycash_categories c on c.id = e.category_id
  where e.created_by = auth.uid()
     or public.has_permission('pettycash.entry', 'approve')
     or public.has_permission('pettycash.entry', 'issue')
     or public.has_permission('pettycash.entry', 'manage')
  order by e.created_at desc;
$$;

-- 7. Storage bucket for vouchers ----------------------------------------------
insert into storage.buckets (id, name, public)
values ('pettycash-docs', 'pettycash-docs', false)
on conflict (id) do nothing;

-- 8. Seed grants --------------------------------------------------------------
-- Billing: approve entries + manage the category list + see all.
insert into public.role_permissions (role_id, resource, action)
select r.id, x.resource, x.action::public.app_action
from public.roles r
cross join (values
  ('pettycash.entry','read'), ('pettycash.entry','approve'),
  ('pettycash.category','read'), ('pettycash.category','manage')
) as x(resource, action)
where r.key = 'billing_member'
on conflict do nothing;

-- Accounts: pay entries + see all.
insert into public.role_permissions (role_id, resource, action)
select r.id, x.resource, x.action::public.app_action
from public.roles r
cross join (values ('pettycash.entry','read'), ('pettycash.entry','issue')) as x(resource, action)
where r.key in ('accounts_member', 'accounts_head')
on conflict do nothing;

-- Finance Head: full oversight of petty cash.
insert into public.role_permissions (role_id, resource, action)
select r.id, x.resource, x.action::public.app_action
from public.roles r
cross join (values
  ('pettycash.entry','read'), ('pettycash.entry','approve'), ('pettycash.entry','issue'),
  ('pettycash.category','read'), ('pettycash.category','manage')
) as x(resource, action)
where r.key = 'finance_head'
on conflict do nothing;
