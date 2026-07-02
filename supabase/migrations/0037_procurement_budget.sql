-- Studio-Masons ERP — Procurement slice 2: the per-project Budget BOQ (versioned)
-- Run AFTER 0036_procurement_department.sql.
--
-- WHAT THIS ADDS  (see docs/procurement-module-plan.md §3, §10)
--   A project's Budget BOQ — the budgeted quantities/rates that later cap what may
--   be ordered. It is PER-PROJECT, so it is gated by the project-aware
--   has_project_permission('procurement.budget', …) — Procurement's team hold that
--   company-wide, so it reaches every project; the Director's re-version approval
--   is a company-wide grant too.
--
--   Shape: a project has one or more BUDGET VERSIONS; the working one is a draft,
--   and releasing it locks it. A budget has first-class PACKAGES, each holding
--   LINE ITEMS (ref, description, unit, qty, rate → amount). Re-versioning a
--   released budget (a fresh draft copied from it) needs the `approve` verb.
--
--   Excel import (parse a Budget BOQ workbook into these rows) is a follow-up; this
--   slice covers the data model + manual entry + the version lifecycle.

-- 1. Register the resource ----------------------------------------------------
insert into public.department_modules (department_id, module_id)
select d.id, 'procurement.budget'
from public.departments d
where d.key = 'procurement'
on conflict do nothing;

insert into public.module_settings (module_id, is_general)
values ('procurement.budget', false)
on conflict (module_id) do nothing;

-- 2. Vocabulary + tables ------------------------------------------------------
do $$ begin
  create type public.procurement_budget_status as enum ('draft', 'released');
exception when duplicate_object then null; end $$;

create table if not exists public.procurement_budgets (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  version_no  int  not null,
  status      public.procurement_budget_status not null default 'draft',
  notes       text,
  created_by  uuid references public.profiles (id) default auth.uid(),
  created_at  timestamptz not null default now(),
  approved_by uuid references public.profiles (id),   -- Director, on a re-version
  released_at timestamptz,
  unique (project_id, version_no)
);
create index if not exists procurement_budgets_project_idx on public.procurement_budgets (project_id);

create table if not exists public.procurement_budget_packages (
  id         uuid primary key default gen_random_uuid(),
  budget_id  uuid not null references public.procurement_budgets (id) on delete cascade,
  name       text not null,
  sort       int  not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists procurement_budget_packages_budget_idx on public.procurement_budget_packages (budget_id);

create table if not exists public.procurement_budget_lines (
  id           uuid primary key default gen_random_uuid(),
  package_id   uuid not null references public.procurement_budget_packages (id) on delete cascade,
  ref          text,
  description  text not null,
  unit         text,
  qty          numeric not null default 0,
  rate         numeric not null default 0,
  supply_rate  numeric,
  install_rate numeric,
  amount       numeric generated always as (qty * rate) stored,
  sort         int not null default 0
);
create index if not exists procurement_budget_lines_package_idx on public.procurement_budget_lines (package_id);

-- 3. Helpers ------------------------------------------------------------------
-- The project a budget belongs to (SECURITY DEFINER so policies can resolve it).
create or replace function public.procurement_budget_project(p_budget uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select project_id from public.procurement_budgets where id = p_budget;
$$;

-- Project-aware gate for a budget by id.
create or replace function public.can_budget(p_budget uuid, p_action public.app_action)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.has_project_permission(
    public.procurement_budget_project(p_budget), 'procurement.budget', p_action);
$$;

-- 4. RLS ----------------------------------------------------------------------
alter table public.procurement_budgets         enable row level security;
alter table public.procurement_budget_packages enable row level security;
alter table public.procurement_budget_lines    enable row level security;

-- Budgets: project-scoped. update OR approve may edit the row (approve = re-version).
drop policy if exists "procurement_budgets_select" on public.procurement_budgets;
create policy "procurement_budgets_select" on public.procurement_budgets
  for select using (public.has_project_permission(project_id, 'procurement.budget', 'read'));

drop policy if exists "procurement_budgets_insert" on public.procurement_budgets;
create policy "procurement_budgets_insert" on public.procurement_budgets
  for insert with check (
    public.has_project_permission(project_id, 'procurement.budget', 'create')
    or public.has_project_permission(project_id, 'procurement.budget', 'approve')
  );

drop policy if exists "procurement_budgets_update" on public.procurement_budgets;
create policy "procurement_budgets_update" on public.procurement_budgets
  for update using (
    public.has_project_permission(project_id, 'procurement.budget', 'update')
    or public.has_project_permission(project_id, 'procurement.budget', 'approve')
  )
  with check (
    public.has_project_permission(project_id, 'procurement.budget', 'update')
    or public.has_project_permission(project_id, 'procurement.budget', 'approve')
  );

drop policy if exists "procurement_budgets_delete" on public.procurement_budgets;
create policy "procurement_budgets_delete" on public.procurement_budgets
  for delete using (public.has_project_permission(project_id, 'procurement.budget', 'delete'));

-- Packages: read with budget:read, write with budget:update.
drop policy if exists "procurement_budget_packages_select" on public.procurement_budget_packages;
create policy "procurement_budget_packages_select" on public.procurement_budget_packages
  for select using (public.can_budget(budget_id, 'read'));

drop policy if exists "procurement_budget_packages_write" on public.procurement_budget_packages;
create policy "procurement_budget_packages_write" on public.procurement_budget_packages
  for all using (public.can_budget(budget_id, 'update'))
  with check (public.can_budget(budget_id, 'update'));

-- Lines: same, resolved through the parent package.
drop policy if exists "procurement_budget_lines_select" on public.procurement_budget_lines;
create policy "procurement_budget_lines_select" on public.procurement_budget_lines
  for select using (exists (
    select 1 from public.procurement_budget_packages pk
    where pk.id = package_id and public.can_budget(pk.budget_id, 'read')
  ));

drop policy if exists "procurement_budget_lines_write" on public.procurement_budget_lines;
create policy "procurement_budget_lines_write" on public.procurement_budget_lines
  for all using (exists (
    select 1 from public.procurement_budget_packages pk
    where pk.id = package_id and public.can_budget(pk.budget_id, 'update')
  ))
  with check (exists (
    select 1 from public.procurement_budget_packages pk
    where pk.id = package_id and public.can_budget(pk.budget_id, 'update')
  ));

-- 5. LOCK — a released budget version is read-only ----------------------------
-- Like the design brief lock: once released, its packages/lines can't be edited
-- by end users; make a new version instead. Service role / SQL (no auth.uid())
-- bypasses, so re-versioning can copy rows in.
create or replace function public.guard_budget_released_lock()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_budget uuid; v_status public.procurement_budget_status;
begin
  if auth.uid() is null then return coalesce(new, old); end if;

  if tg_table_name = 'procurement_budget_packages' then
    v_budget := coalesce(new.budget_id, old.budget_id);
  else
    select pk.budget_id into v_budget
    from public.procurement_budget_packages pk
    where pk.id = coalesce(new.package_id, old.package_id);
  end if;

  select status into v_status from public.procurement_budgets where id = v_budget;
  if v_status = 'released' then
    raise exception 'This budget version is released and locked — make a new version to edit';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists procurement_budget_packages_lock on public.procurement_budget_packages;
create trigger procurement_budget_packages_lock
  before insert or update or delete on public.procurement_budget_packages
  for each row execute function public.guard_budget_released_lock();

drop trigger if exists procurement_budget_lines_lock on public.procurement_budget_lines;
create trigger procurement_budget_lines_lock
  before insert or update or delete on public.procurement_budget_lines
  for each row execute function public.guard_budget_released_lock();

-- 6. Version-lifecycle RPCs ---------------------------------------------------
-- Start a project's first budget (draft v1). Errors if one already exists.
create or replace function public.start_budget(p_project uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  if not public.has_project_permission(p_project, 'procurement.budget', 'create') then
    raise exception 'Not authorized to start a budget on this project';
  end if;
  if exists (select 1 from public.procurement_budgets where project_id = p_project) then
    raise exception 'This project already has a budget';
  end if;
  insert into public.procurement_budgets (project_id, version_no, status)
  values (p_project, 1, 'draft')
  returning id into v_id;
  return v_id;
end;
$$;

-- Release a draft budget — locks it for ordering to reference.
create or replace function public.release_budget(p_budget uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_project uuid; v_status public.procurement_budget_status;
begin
  select project_id, status into v_project, v_status
  from public.procurement_budgets where id = p_budget;
  if v_project is null then raise exception 'Budget not found'; end if;
  if not public.has_project_permission(v_project, 'procurement.budget', 'update') then
    raise exception 'Not authorized to release this budget';
  end if;
  if v_status <> 'draft' then raise exception 'Only a draft can be released'; end if;
  update public.procurement_budgets
     set status = 'released', released_at = now()
   where id = p_budget;
end;
$$;

-- Re-version: a fresh draft copied from the latest released version. The Director
-- sign-off — needs the `approve` verb.
create or replace function public.new_budget_version(p_project uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_new uuid; v_next int; v_src uuid;
  pk record; v_new_pkg uuid;
begin
  if not public.has_project_permission(p_project, 'procurement.budget', 'approve') then
    raise exception 'Re-versioning a budget needs approval';
  end if;
  if exists (
    select 1 from public.procurement_budgets
    where project_id = p_project and status = 'draft'
  ) then
    raise exception 'There is already a draft version — release or edit it first';
  end if;

  select id, version_no + 1 into v_src, v_next
  from public.procurement_budgets
  where project_id = p_project
  order by version_no desc limit 1;
  if v_src is null then raise exception 'No budget to re-version'; end if;

  insert into public.procurement_budgets (project_id, version_no, status, approved_by)
  values (p_project, v_next, 'draft', auth.uid())
  returning id into v_new;

  -- Copy packages and their lines (draft, so the lock allows it).
  for pk in
    select * from public.procurement_budget_packages where budget_id = v_src order by sort
  loop
    insert into public.procurement_budget_packages (budget_id, name, sort)
    values (v_new, pk.name, pk.sort) returning id into v_new_pkg;

    insert into public.procurement_budget_lines
      (package_id, ref, description, unit, qty, rate, supply_rate, install_rate, sort)
    select v_new_pkg, ref, description, unit, qty, rate, supply_rate, install_rate, sort
    from public.procurement_budget_lines where package_id = pk.id;
  end loop;

  return v_new;
end;
$$;

-- 7. Seed the procurement roles' budget grants --------------------------------
-- Manager: full control incl. delete. Team member: import + edit, not delete.
-- (Director's `approve` for re-versions stays a company-wide grant via /access.)
insert into public.role_permissions (role_id, resource, action)
select r.id, 'procurement.budget', x.action::public.app_action
from public.roles r
cross join (values ('read'), ('create'), ('update'), ('delete')) as x(action)
where r.key = 'procurement_manager'
on conflict do nothing;

insert into public.role_permissions (role_id, resource, action)
select r.id, 'procurement.budget', x.action::public.app_action
from public.roles r
cross join (values ('read'), ('create'), ('update')) as x(action)
where r.key = 'procurement_member'
on conflict do nothing;
