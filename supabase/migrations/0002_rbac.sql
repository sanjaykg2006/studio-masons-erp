-- Studio-Masons ERP — RBAC (Role-Based Access Control)
-- Run this in the Supabase SQL Editor AFTER 0001_init.sql.
--
-- MODEL (single role per user):
--   * Action   — fixed CRUD verb: create | read | update | delete.
--   * Resource — a module id from the app's module registry (free text), e.g.
--                'dashboard', 'projects'. '*' is a wildcard (superadmin).
--   * Role     — a named, editable bag of permissions (admin, staff, ...).
--   * A permission is one (resource, action) pair. A row in role_permissions
--     existing = ALLOWED. Absence = DENIED (deny-by-default).
--   * Each user has exactly one role via profiles.role_id.
--
-- Enforcement happens here, in the database, via the has_permission() function
-- used by Row-Level Security policies. App-layer guards and UI gating mirror it
-- but are NOT the security boundary — this is.

-- 1. Fixed CRUD verbs ---------------------------------------------------------
do $$ begin
  create type public.app_action as enum ('create', 'read', 'update', 'delete');
exception
  when duplicate_object then null;
end $$;

-- 2. Roles + their granted permissions ----------------------------------------
create table if not exists public.roles (
  id          uuid primary key default gen_random_uuid(),
  key         text unique not null,             -- stable id, e.g. 'admin'
  label       text not null,                    -- display name, editable
  description text,
  is_system   boolean not null default false,   -- built-ins: cannot be deleted
  created_at  timestamptz not null default now()
);

-- A row here means "this role is allowed (resource, action)".
create table if not exists public.role_permissions (
  role_id   uuid not null references public.roles (id) on delete cascade,
  resource  text not null,                      -- module id, or '*' wildcard
  action    public.app_action not null,
  primary key (role_id, resource, action)
);

-- 3. Link each user to one role -----------------------------------------------
-- Evolves profiles.role (loose text) into a real foreign key. NULL = no role,
-- which (deny-by-default) means no permissions.
alter table public.profiles
  add column if not exists role_id uuid references public.roles (id);

-- 4. THE BACKBONE — permission check used by every RLS policy -----------------
-- SECURITY DEFINER so it can read the RBAC tables regardless of the caller's
-- own RLS; STABLE so it can be reused freely within a query.
create or replace function public.has_permission(
  p_resource text,
  p_action   public.app_action
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    join public.role_permissions rp on rp.role_id = p.role_id
    where p.id = auth.uid()
      and rp.action = p_action
      and rp.resource in (p_resource, '*')
  );
$$;

-- 4b. The current user's own permissions -------------------------------------
-- The app loads this to gate UI and server actions. SECURITY DEFINER so any
-- authenticated user can read it (RLS on role_permissions otherwise restricts
-- reads to access-managers); it only ever returns the CALLER's own grants.
create or replace function public.my_permissions()
returns table (resource text, action public.app_action)
language sql
stable
security definer
set search_path = public
as $$
  select rp.resource, rp.action
  from public.profiles p
  join public.role_permissions rp on rp.role_id = p.role_id
  where p.id = auth.uid();
$$;

-- 5. RLS — the RBAC tables are managed only via the 'access' resource ---------
alter table public.roles enable row level security;
alter table public.role_permissions enable row level security;

drop policy if exists "roles_read" on public.roles;
create policy "roles_read" on public.roles
  for select using (has_permission('access', 'read'));

drop policy if exists "roles_insert" on public.roles;
create policy "roles_insert" on public.roles
  for insert with check (has_permission('access', 'create'));

drop policy if exists "roles_update" on public.roles;
create policy "roles_update" on public.roles
  for update using (has_permission('access', 'update'))
  with check (has_permission('access', 'update'));

-- System roles are never deletable, even with the permission.
drop policy if exists "roles_delete" on public.roles;
create policy "roles_delete" on public.roles
  for delete using (has_permission('access', 'delete') and is_system = false);

drop policy if exists "role_permissions_read" on public.role_permissions;
create policy "role_permissions_read" on public.role_permissions
  for select using (has_permission('access', 'read'));

drop policy if exists "role_permissions_insert" on public.role_permissions;
create policy "role_permissions_insert" on public.role_permissions
  for insert with check (has_permission('access', 'update'));

drop policy if exists "role_permissions_delete" on public.role_permissions;
create policy "role_permissions_delete" on public.role_permissions
  for delete using (has_permission('access', 'update'));

-- 6. Profiles — let access-managers see everyone and assign roles ------------
-- (The existing profiles_select_own / profiles_update_own policies from 0001
--  remain; RLS policies are OR'd, so users keep self-access.)
drop policy if exists "profiles_admin_select" on public.profiles;
create policy "profiles_admin_select" on public.profiles
  for select using (has_permission('access', 'read'));

drop policy if exists "profiles_admin_update" on public.profiles;
create policy "profiles_admin_update" on public.profiles
  for update using (has_permission('access', 'update'))
  with check (has_permission('access', 'update'));

-- Prevent privilege escalation: a user editing their OWN profile (allowed by
-- profiles_update_own) must not be able to change their role_id. Only someone
-- with 'access:update' may change a role. Enforced by trigger because RLS
-- WITH CHECK cannot compare against the previous row value.
create or replace function public.guard_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- auth.uid() is null in trusted server contexts (SQL Editor / service role /
  -- SSO provisioning) which already bypass RLS; only guard real end users.
  if new.role_id is distinct from old.role_id
     and auth.uid() is not null
     and not has_permission('access', 'update') then
    raise exception 'Not authorized to change role';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_role on public.profiles;
create trigger profiles_guard_role
  before update on public.profiles
  for each row execute function public.guard_profile_role();

-- 7. Seed built-in roles ------------------------------------------------------
insert into public.roles (key, label, description, is_system) values
  ('admin', 'Administrator', 'Full access to everything, including access control.', true),
  ('staff', 'Staff',          'Standard member. Read access to core modules.',        true)
on conflict (key) do nothing;

-- admin: wildcard grant across all resources and actions.
insert into public.role_permissions (role_id, resource, action)
select r.id, '*', a.action
from public.roles r
cross join (
  select unnest(enum_range(null::public.app_action)) as action
) a
where r.key = 'admin'
on conflict do nothing;

-- staff: read-only on the dashboard to start (admins refine this in the UI).
insert into public.role_permissions (role_id, resource, action)
select r.id, 'dashboard', 'read'::public.app_action
from public.roles r
where r.key = 'staff'
on conflict do nothing;

-- 8. Migrate existing profiles.role (text) -> profiles.role_id ----------------
update public.profiles p
set role_id = r.id
from public.roles r
where p.role_id is null
  and r.key = p.role;

-- Any profile still without a role falls back to 'staff' so no one is orphaned.
update public.profiles p
set role_id = r.id
from public.roles r
where p.role_id is null
  and r.key = 'staff';

-- Old loose text column is now redundant.
alter table public.profiles drop column if exists role;
