-- Studio-Masons ERP — Department leads manage their own department's matrix
-- Run AFTER 0009_access_model.sql.
--
-- THE SPLIT (decided with the user):
--   * Admin (Access Control module): creates roles + departments, tags roles to a
--     department, says which modules a department may use, marks "general" access,
--     invites people, and APPOINTS each department's lead.
--   * Lead (a department's own Team Access page): for the roles the admin created
--     under THEIR department only — ticks the permission matrix (their department's
--     modules), flags a role department-wide, and assigns people into those roles.
--
-- A lead can never see or touch another department, the global/system roles, or
-- the general/cross-cutting modules. Enforced HERE (RLS + SECURITY DEFINER RPCs),
-- not just in the UI.

-- 1. Who leads which department ----------------------------------------------
create table if not exists public.department_leads (
  department_id uuid not null references public.departments (id) on delete cascade,
  user_id       uuid not null references public.profiles (id)    on delete cascade,
  primary key (department_id, user_id)
);

alter table public.department_leads enable row level security;

-- Only access-managers (admins) appoint or remove leads. A user may read their
-- own lead rows so the app can route them to their Team Access page.
drop policy if exists "department_leads_read" on public.department_leads;
create policy "department_leads_read" on public.department_leads
  for select using (has_permission('access', 'read') or user_id = auth.uid());

drop policy if exists "department_leads_write" on public.department_leads;
create policy "department_leads_write" on public.department_leads
  for all using (has_permission('access', 'update'))
  with check (has_permission('access', 'update'));

-- 2. Helpers — the lead-scoping primitives (mirror has_permission) ------------
create or replace function public.is_department_lead(p_department uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.department_leads
    where department_id = p_department and user_id = auth.uid()
  );
$$;

create or replace function public.leads_any_department()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.department_leads where user_id = auth.uid()
  );
$$;

create or replace function public.my_lead_departments()
returns table (department_id uuid)
language sql stable security definer set search_path = public
as $$
  select department_id from public.department_leads where user_id = auth.uid();
$$;

-- May the caller, as a lead, grant (resource) on (role)? True only when the role
-- is in a department they lead AND the module belongs to that department AND it
-- is NOT a general/cross-cutting module. This is the lead's matrix boundary.
create or replace function public.lead_can_grant(p_role uuid, p_resource text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.roles r
    where r.id = p_role
      and r.department_id is not null
      and public.is_department_lead(r.department_id)
      and exists (
        select 1 from public.department_modules dm
        where dm.department_id = r.department_id and dm.module_id = p_resource
      )
      and not exists (
        select 1 from public.module_settings ms
        where ms.module_id = p_resource and ms.is_general
      )
  );
$$;

-- 3. Open up reads to a department's lead (admin branch kept, lead branch added)
-- A lead may read only THEIR department's row, its roles, those roles' grants,
-- and its module list. Everyone else's stays invisible.
drop policy if exists "roles_read" on public.roles;
create policy "roles_read" on public.roles
  for select using (
    has_permission('access', 'read')
    or (department_id is not null and is_department_lead(department_id))
  );

drop policy if exists "role_permissions_read" on public.role_permissions;
create policy "role_permissions_read" on public.role_permissions
  for select using (
    has_permission('access', 'read')
    or exists (
      select 1 from public.roles r
      where r.id = role_permissions.role_id
        and r.department_id is not null
        and is_department_lead(r.department_id)
    )
  );

drop policy if exists "departments_read" on public.departments;
create policy "departments_read" on public.departments
  for select using (
    has_permission('access', 'read') or is_department_lead(id)
  );

drop policy if exists "department_modules_read" on public.department_modules;
create policy "department_modules_read" on public.department_modules
  for select using (
    has_permission('access', 'read') or is_department_lead(department_id)
  );

-- Leads need to know which modules are "general" (to exclude them) when rendering.
drop policy if exists "module_settings_read" on public.module_settings;
create policy "module_settings_read" on public.module_settings
  for select using (
    has_permission('access', 'read') or leads_any_department()
  );

-- 4. The lead's matrix writes — scoped insert/delete on role_permissions -------
-- A lead may tick/untick a cell only via lead_can_grant(). The 0004 guard trigger
-- still also runs, double-checking the module belongs to the role's department.
drop policy if exists "role_permissions_insert" on public.role_permissions;
create policy "role_permissions_insert" on public.role_permissions
  for insert with check (
    has_permission('access', 'update') or lead_can_grant(role_id, resource)
  );

drop policy if exists "role_permissions_delete" on public.role_permissions;
create policy "role_permissions_delete" on public.role_permissions
  for delete using (
    has_permission('access', 'update') or lead_can_grant(role_id, resource)
  );

-- 5. Leads can see people (to assign them) ------------------------------------
-- Read-only; leads cannot edit arbitrary profile fields. Role assignment is done
-- through the SECURITY DEFINER RPCs below, which restrict columns and scope.
drop policy if exists "profiles_lead_select" on public.profiles;
create policy "profiles_lead_select" on public.profiles
  for select using (leads_any_department());

-- 6. Let a lead's role assignment past the privilege-escalation guard ----------
-- 0002's guard_profile_role blocks role changes by non access-managers. Widen it:
-- a lead may also set a profile's role INTO a role in their department, or clear a
-- role that currently sits in their department. Any other change still raises.
create or replace function public.guard_profile_role()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.role_id is distinct from old.role_id
     and auth.uid() is not null
     and not has_permission('access', 'update')
     and not (
       new.role_id is not null and exists (
         select 1 from public.roles r
         where r.id = new.role_id
           and r.department_id is not null
           and is_department_lead(r.department_id)
       )
     )
     and not (
       old.role_id is not null and exists (
         select 1 from public.roles r
         where r.id = old.role_id
           and r.department_id is not null
           and is_department_lead(r.department_id)
       )
     )
  then
    raise exception 'Not authorized to change role';
  end if;
  return new;
end;
$$;

-- 7. Lead-scoped RPCs — the only way a lead changes role config / membership ---
-- SECURITY DEFINER (bypass table RLS) but each re-checks is_department_lead, so a
-- lead can act ONLY within a department they lead. The app calls these.

-- Assign a person into one of this department's roles.
create or replace function public.set_member_department_role(p_user uuid, p_role uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_dept uuid;
begin
  select department_id into v_dept from public.roles where id = p_role;
  if v_dept is null or not public.is_department_lead(v_dept) then
    raise exception 'Not authorized to assign this role';
  end if;
  update public.profiles set role_id = p_role where id = p_user;
end;
$$;

-- Remove a person from this department (only if their current role is in it).
create or replace function public.clear_member_department_role(p_user uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_dept uuid;
begin
  select r.department_id into v_dept
  from public.profiles p
  join public.roles r on r.id = p.role_id
  where p.id = p_user;
  if v_dept is null or not public.is_department_lead(v_dept) then
    raise exception 'Not authorized to change this member';
  end if;
  update public.profiles set role_id = null where id = p_user;
end;
$$;

-- Flag one of this department's roles department-wide (sees all projects) or not.
create or replace function public.set_role_department_wide(p_role uuid, p_wide boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_dept uuid;
begin
  select department_id into v_dept from public.roles where id = p_role;
  if v_dept is null or not public.is_department_lead(v_dept) then
    raise exception 'Not authorized to change this role';
  end if;
  update public.roles set is_department_wide = p_wide where id = p_role;
end;
$$;
