-- Studio-Masons ERP — RBAC hardening: seal the doors found in the security audit
-- Run AFTER 0030_task_times_and_docs.sql.
--
-- BACKGROUND (see docs/rbac-security-audit.md)
--   Door 1 (company/roles) is guarded, but Door 2 (per-person department grants)
--   was not. A department lead could write powers the UI never offers — including
--   the "*" (everything) power or the "access" (Access Control) power — and be
--   treated as a full admin. And the "works on all projects" role reached EVERY
--   department's projects, not just its own.
--
-- THIS MIGRATION
--   1. Guards the per-person team list: never "*"/"access", only the department's
--      own modules (or general/back-office ones). Mirrors the 0004 role guard.
--   2. Guards the team record: an all-projects role must belong to that department.
--   3. Also blocks "access" from department ROLES (0004 already blocked "*").
--   4. Scopes "works on all projects" to the department that OWNS the project, and
--      makes it work for every department (not only Design).
--   5. Cleans up any pre-existing rows that violate the new rules.
--   No screens change; these only close gaps behind them.

-- 1. Guard the per-person team grants -----------------------------------------
create or replace function public.guard_team_member_permission()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- These two powers are Door 1 (company-wide) and must never be handed out
  -- through a department, even if a module was mistakenly flagged "general".
  if new.resource in ('*', 'access') then
    raise exception 'This power cannot be granted through a department';
  end if;
  -- General (back-office) modules are grantable anywhere.
  if exists (
    select 1 from public.module_settings
    where module_id = new.resource and is_general
  ) then
    return new;
  end if;
  -- Otherwise the module must belong to THIS department.
  if exists (
    select 1 from public.department_modules
    where department_id = new.department_id and module_id = new.resource
  ) then
    return new;
  end if;
  raise exception 'Module "%" is not available to this department', new.resource;
end;
$$;

drop trigger if exists team_member_permissions_guard on public.team_member_permissions;
create trigger team_member_permissions_guard
  before insert or update on public.team_member_permissions
  for each row execute function public.guard_team_member_permission();

-- 2. Guard the team record: all-projects role must belong to the department ----
create or replace function public.guard_team_member_role()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.all_projects and new.all_projects_role_id is not null then
    if not exists (
      select 1 from public.roles r
      where r.id = new.all_projects_role_id
        and r.department_id = new.department_id
    ) then
      raise exception 'The all-projects role must belong to this department';
    end if;
  end if;
  -- Keep the record tidy: no lingering role when the switch is off.
  if not new.all_projects then
    new.all_projects_role_id := null;
  end if;
  return new;
end;
$$;

drop trigger if exists team_members_guard on public.team_members;
create trigger team_members_guard
  before insert or update on public.team_members
  for each row execute function public.guard_team_member_role();

-- 3. Also block "access" from department roles (0004 already blocked "*") ------
create or replace function public.guard_role_permission()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_dept   uuid;
  v_system boolean;
begin
  select department_id, is_system into v_dept, v_system
  from public.roles where id = new.role_id;

  -- Global / system roles (admin, staff) are unrestricted.
  if v_system or v_dept is null then
    return new;
  end if;

  -- "*" (everything) and "access" (Access Control) are Door 1 only.
  if new.resource in ('*', 'access') then
    raise exception 'This power cannot be granted to a department role';
  end if;

  if exists (
    select 1 from public.module_settings
    where module_id = new.resource and is_general
  ) then
    return new;
  end if;

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
-- (trigger role_permissions_guard from 0004 still points at this function.)

-- 4. Scope "works on all projects" to the owning department, every department --
create or replace function public.has_project_permission(
  p_project  uuid,
  p_resource text,
  p_action   public.app_action
)
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    public.has_permission(p_resource, p_action)
    or exists (
      select 1
      from public.project_members m
      join public.role_permissions rp on rp.role_id = m.role_id
      where m.project_id = p_project
        and m.user_id = auth.uid()
        and rp.action = p_action
        and rp.resource in (p_resource, '*')
    )
    or exists (
      select 1
      from public.team_members tm
      join public.role_permissions rp on rp.role_id = tm.all_projects_role_id
      where tm.user_id = auth.uid()
        and tm.all_projects
        and tm.department_id = (select department_id from public.projects where id = p_project)
        and rp.action = p_action
        and rp.resource in (p_resource, '*')
    );
$$;

-- Keep UI gating in step: show an all-projects senior their controls, scoped to
-- the project's own department.
create or replace function public.my_project_permissions(p_project uuid)
returns table (resource text, action public.app_action)
language sql stable security definer set search_path = public
as $$
  select rp.resource, rp.action
  from public.profiles p
  join public.role_permissions rp on rp.role_id = p.role_id
  where p.id = auth.uid()
  union
  select rp.resource, rp.action
  from public.project_members m
  join public.role_permissions rp on rp.role_id = m.role_id
  where m.project_id = p_project and m.user_id = auth.uid()
  union
  select tmp.resource, tmp.action
  from public.team_member_permissions tmp
  where tmp.user_id = auth.uid()
  union
  select rp.resource, rp.action
  from public.team_members tm
  join public.role_permissions rp on rp.role_id = tm.all_projects_role_id
  where tm.user_id = auth.uid()
    and tm.all_projects
    and tm.department_id = (select department_id from public.projects where id = p_project);
$$;

-- 5. Clean up any rows that already break the new rules ------------------------
-- Remove forbidden team grants (there should be none in normal use).
delete from public.team_member_permissions where resource in ('*', 'access');

-- Reset any all-projects role that doesn't belong to the member's department.
update public.team_members tm
   set all_projects = false, all_projects_role_id = null
 where tm.all_projects_role_id is not null
   and not exists (
     select 1 from public.roles r
     where r.id = tm.all_projects_role_id
       and r.department_id = tm.department_id
   );
