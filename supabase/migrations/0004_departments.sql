-- Studio-Masons ERP — Departments layer over RBAC
-- Run in the Supabase SQL Editor AFTER 0003_audit.sql.
--
-- WHY: roles were a single flat list. A real company organises module access by
-- department (Sales, Operations, ...). This migration adds an ORGANISING layer
-- on top of the existing (resource, action) permission model — it does NOT change
-- how has_permission() works. What it changes is WHICH modules a role may be
-- granted:
--
--   * department          — a named group (Sales, Operations, ...).
--   * department_modules  — which modules belong to a department (many-to-many:
--                           a module can be shared by several departments).
--   * module_settings     — flags a module as "general" (Dashboard, Access
--                           Control, Activity Log): general modules appear in
--                           EVERY role's matrix, regardless of department.
--   * roles.department_id — a role now lives under one department. System/global
--                           roles (admin, staff) keep NULL and are unrestricted.
--
-- ENFORCEMENT: a guard trigger on role_permissions ensures a department role can
-- only be granted General modules or modules assigned to its own department. The
-- UI mirrors this, but the trigger is the real boundary.

-- 1. Departments --------------------------------------------------------------
create table if not exists public.departments (
  id          uuid primary key default gen_random_uuid(),
  key         text unique not null,             -- stable id, e.g. 'sales'
  label       text not null,                    -- display name, editable
  description text,
  is_system   boolean not null default false,   -- reserved; not deletable
  created_at  timestamptz not null default now()
);

-- 2. Which modules belong to a department (many-to-many) ----------------------
-- module_id is a module/resource id from the app registry (free text), e.g.
-- 'projects'. A module may appear under several departments.
create table if not exists public.department_modules (
  department_id uuid not null references public.departments (id) on delete cascade,
  module_id     text not null,
  primary key (department_id, module_id)
);

-- 3. Per-module settings — the admin-flagged "general" marker ------------------
-- A module listed here with is_general = true shows in every role's matrix and
-- is grantable to any role (e.g. dashboard, access, audit). Modules absent from
-- this table are treated as non-general.
create table if not exists public.module_settings (
  module_id  text primary key,
  is_general boolean not null default false
);

-- 4. A role now belongs to a department ---------------------------------------
-- NULL = a global/system role (admin, staff): unrestricted by the guard below.
alter table public.roles
  add column if not exists department_id uuid references public.departments (id);

-- 5. THE GUARD — a department role can only hold General or in-department modules
create or replace function public.guard_role_permission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dept   uuid;
  v_system boolean;
begin
  select department_id, is_system
    into v_dept, v_system
  from public.roles
  where id = new.role_id;

  -- Global / system roles (admin, staff) are unrestricted.
  if v_system or v_dept is null then
    return new;
  end if;

  -- The '*' wildcard is reserved for global roles only.
  if new.resource = '*' then
    raise exception 'Wildcard access is not allowed for a department role';
  end if;

  -- General modules are grantable to any role.
  if exists (
    select 1 from public.module_settings
    where module_id = new.resource and is_general
  ) then
    return new;
  end if;

  -- Otherwise the module must be assigned to this role's department.
  if exists (
    select 1 from public.department_modules
    where department_id = v_dept and module_id = new.resource
  ) then
    return new;
  end if;

  raise exception
    'Module "%" is not available to this role''s department', new.resource;
end;
$$;

drop trigger if exists role_permissions_guard on public.role_permissions;
create trigger role_permissions_guard
  before insert or update on public.role_permissions
  for each row execute function public.guard_role_permission();

-- 6. RLS — the department tables are managed via the 'access' resource ---------
alter table public.departments       enable row level security;
alter table public.department_modules enable row level security;
alter table public.module_settings    enable row level security;

drop policy if exists "departments_read" on public.departments;
create policy "departments_read" on public.departments
  for select using (has_permission('access', 'read'));

drop policy if exists "departments_insert" on public.departments;
create policy "departments_insert" on public.departments
  for insert with check (has_permission('access', 'create'));

drop policy if exists "departments_update" on public.departments;
create policy "departments_update" on public.departments
  for update using (has_permission('access', 'update'))
  with check (has_permission('access', 'update'));

-- System departments are never deletable, even with the permission.
drop policy if exists "departments_delete" on public.departments;
create policy "departments_delete" on public.departments
  for delete using (has_permission('access', 'delete') and is_system = false);

drop policy if exists "department_modules_read" on public.department_modules;
create policy "department_modules_read" on public.department_modules
  for select using (has_permission('access', 'read'));

drop policy if exists "department_modules_insert" on public.department_modules;
create policy "department_modules_insert" on public.department_modules
  for insert with check (has_permission('access', 'update'));

drop policy if exists "department_modules_delete" on public.department_modules;
create policy "department_modules_delete" on public.department_modules
  for delete using (has_permission('access', 'update'));

drop policy if exists "module_settings_read" on public.module_settings;
create policy "module_settings_read" on public.module_settings
  for select using (has_permission('access', 'read'));

drop policy if exists "module_settings_write" on public.module_settings;
create policy "module_settings_write" on public.module_settings
  for all using (has_permission('access', 'update'))
  with check (has_permission('access', 'update'));

-- 7. Seed — the three current modules are "general" by default ----------------
insert into public.module_settings (module_id, is_general) values
  ('dashboard', true),
  ('access',    true),
  ('audit',     true)
on conflict (module_id) do update set is_general = excluded.is_general;
