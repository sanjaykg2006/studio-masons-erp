-- Studio-Masons ERP — Team Access (Plane 2: the "Department door"), per-user
-- Run in the Supabase SQL Editor AFTER 0014_back_office_roles.sql.
--
-- THE REDESIGN (door 2 of 3): inside a department, access is set PER PERSON, not
-- per role. A lead opens their department, ticks what each teammate can do, and
-- those grants apply across the whole department (every project in it + the
-- department's shared screens). People who should only touch SPECIFIC projects
-- are handled by project roles instead (door 3, 0013).
--
--   * team_members            — who is in a department (the people grid's rows).
--   * team_member_permissions — each person's (module, action) ticks.
--
-- HOW IT ENFORCES: has_permission() now ALSO honours a person's team grants — so
-- a tick takes effect everywhere the app already checks permissions, with no
-- change to any existing RLS policy. has_project_permission() already builds on
-- has_permission(), so team grants reach every project in the department; project
-- roles keep adding per-project access on top. The change is purely ADDITIVE:
-- nothing that worked before is removed.
--
-- This replaces the old "lead edits a department ROLE matrix" flow (0010). That
-- machinery is left in place (harmless) and can be retired once this is verified.

-- 1. Tables -------------------------------------------------------------------

-- Department membership: the rows of the Team Access people grid. A person can be
-- in several departments.
create table if not exists public.team_members (
  department_id uuid not null references public.departments (id) on delete cascade,
  user_id       uuid not null references public.profiles (id)    on delete cascade,
  added_by      uuid references public.profiles (id),
  added_at      timestamptz not null default now(),
  primary key (department_id, user_id)
);

-- Each person's direct grants within a department — one row per ticked cell.
create table if not exists public.team_member_permissions (
  department_id uuid not null references public.departments (id) on delete cascade,
  user_id       uuid not null references public.profiles (id)    on delete cascade,
  resource      text not null,
  action        public.app_action not null,
  primary key (department_id, user_id, resource, action)
);

-- 2. THE BACKBONE — has_permission() now unions team grants -------------------
-- Additive: a user is allowed if their (back-office) role grants it OR any of
-- their team grants does. Reads team_member_permissions directly (SECURITY
-- DEFINER bypasses RLS, so no recursion with the policies below).
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
  select
    exists (
      select 1
      from public.profiles p
      join public.role_permissions rp on rp.role_id = p.role_id
      where p.id = auth.uid()
        and rp.action = p_action
        and rp.resource in (p_resource, '*')
    )
    or exists (
      select 1
      from public.team_member_permissions tmp
      where tmp.user_id = auth.uid()
        and tmp.action = p_action
        and tmp.resource in (p_resource, '*')
    );
$$;

-- The caller's own effective verbs (role grants ∪ team grants), for UI gating.
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
  where p.id = auth.uid()
  union
  select tmp.resource, tmp.action
  from public.team_member_permissions tmp
  where tmp.user_id = auth.uid();
$$;

-- 3. RLS — leads manage their department; people may read their own rows -------
alter table public.team_members            enable row level security;
alter table public.team_member_permissions enable row level security;

drop policy if exists "team_members_read" on public.team_members;
create policy "team_members_read" on public.team_members
  for select using (
    has_permission('access', 'read')
    or is_department_lead(department_id)
    or user_id = auth.uid()
  );

drop policy if exists "team_members_write" on public.team_members;
create policy "team_members_write" on public.team_members
  for all using (
    has_permission('access', 'update') or is_department_lead(department_id)
  )
  with check (
    has_permission('access', 'update') or is_department_lead(department_id)
  );

drop policy if exists "team_member_permissions_read" on public.team_member_permissions;
create policy "team_member_permissions_read" on public.team_member_permissions
  for select using (
    has_permission('access', 'read')
    or is_department_lead(department_id)
    or user_id = auth.uid()
  );

drop policy if exists "team_member_permissions_write" on public.team_member_permissions;
create policy "team_member_permissions_write" on public.team_member_permissions
  for all using (
    has_permission('access', 'update') or is_department_lead(department_id)
  )
  with check (
    has_permission('access', 'update') or is_department_lead(department_id)
  );

-- 4. Lead-scoped write RPCs — validation + friendly errors --------------------

-- May the caller manage this department's team?
create or replace function public.can_manage_team(p_dept uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.has_permission('access', 'update')
      or public.is_department_lead(p_dept);
$$;

-- Add a person to a department's team.
create or replace function public.add_team_member(p_dept uuid, p_user uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.can_manage_team(p_dept) then
    raise exception 'Not authorized to manage this team';
  end if;
  insert into public.team_members (department_id, user_id, added_by)
  values (p_dept, p_user, auth.uid())
  on conflict do nothing;
end;
$$;

-- Remove a person from a department's team (and drop their grants there).
create or replace function public.remove_team_member(p_dept uuid, p_user uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.can_manage_team(p_dept) then
    raise exception 'Not authorized to manage this team';
  end if;
  delete from public.team_member_permissions
    where department_id = p_dept and user_id = p_user;
  delete from public.team_members
    where department_id = p_dept and user_id = p_user;
end;
$$;

-- Tick / untick one (resource, action) for a person in a department. The module
-- must belong to the department (or be a general/back-office one).
create or replace function public.set_team_member_permission(
  p_dept     uuid,
  p_user     uuid,
  p_resource text,
  p_action   public.app_action,
  p_grant    boolean
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.can_manage_team(p_dept) then
    raise exception 'Not authorized to manage this team';
  end if;
  if not exists (
    select 1 from public.team_members
    where department_id = p_dept and user_id = p_user
  ) then
    raise exception 'Add this person to the team first';
  end if;
  if not exists (
        select 1 from public.department_modules
        where department_id = p_dept and module_id = p_resource
      )
     and not exists (
        select 1 from public.module_settings
        where module_id = p_resource and is_general
      )
  then
    raise exception 'Module "%" is not available to this department', p_resource;
  end if;

  if p_grant then
    insert into public.team_member_permissions (department_id, user_id, resource, action)
    values (p_dept, p_user, p_resource, p_action)
    on conflict do nothing;
  else
    delete from public.team_member_permissions
    where department_id = p_dept and user_id = p_user
      and resource = p_resource and action = p_action;
  end if;
end;
$$;

-- 5. Reach + UI gating for team grants ---------------------------------------
-- A purely team-granted person (no role, not a project member) must still reach
-- the Design module and see the controls they're allowed. has_permission()
-- already covers their server-side checks; these two surface them in the UI.

-- Sidebar link + /design landing: allowed via any design.project:read grant
-- (role OR team, through has_permission) or project membership.
create or replace function public.has_design_access()
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    public.has_permission('design.project', 'read')
    or exists (
      select 1 from public.design_project_members m where m.user_id = auth.uid()
    );
$$;

-- The caller's effective verbs on one project, for per-project UI gating:
-- role grants ∪ project-membership grants ∪ team grants (dept-wide).
create or replace function public.my_project_permissions(p_project uuid)
returns table (resource text, action public.app_action)
language sql
stable
security definer
set search_path = public
as $$
  select rp.resource, rp.action
  from public.profiles p
  join public.role_permissions rp on rp.role_id = p.role_id
  where p.id = auth.uid()
  union
  select rp.resource, rp.action
  from public.design_project_members m
  join public.role_permissions rp on rp.role_id = m.role_id
  where m.project_id = p_project and m.user_id = auth.uid()
  union
  select tmp.resource, tmp.action
  from public.team_member_permissions tmp
  where tmp.user_id = auth.uid();
$$;

-- 6. One-time data migration — old department-wide role holders -> team grants -
-- Anyone whose single role is a DEPARTMENT-WIDE department role (e.g. Design's
-- Director / Senior PA) is ALSO recorded as a team member with the same grants,
-- so they appear (and stay manageable) on the new per-person Team Access page.
-- Their existing role is left in place, so nothing they can do today changes —
-- the role can be retired later once the per-user model is fully verified.
-- Per-project roles (Designer, Junior, ...) are untouched.
do $$
declare r record;
begin
  for r in
    select p.id as user_id, ro.department_id, ro.id as role_id
    from public.profiles p
    join public.roles ro on ro.id = p.role_id
    where ro.department_id is not null
      and ro.is_department_wide
  loop
    insert into public.team_members (department_id, user_id)
    values (r.department_id, r.user_id)
    on conflict do nothing;

    insert into public.team_member_permissions (department_id, user_id, resource, action)
    select r.department_id, r.user_id, rp.resource, rp.action
    from public.role_permissions rp
    where rp.role_id = r.role_id
      and rp.resource <> '*'
    on conflict do nothing;
  end loop;
end $$;
