-- Studio-Masons ERP — Back Office roles (Plane 1: the "Office door")
-- Run in the Supabase SQL Editor AFTER 0013_design_role_management.sql.
--
-- THE REDESIGN (door 1 of 3): access splits into three independent planes —
--   1. Back Office  — HR's job titles, ROLE-based, back-office screens only.
--   2. Team Access  — a lead's per-user grants (door 2, later).
--   3. Projects     — per-project role assignment (door 3, shipped in 0013).
--
-- This migration makes plane 1 genuinely INDEPENDENT: a Back Office role (a
-- department-less, non-system role — what the UI calls a "job title") may ONLY
-- be granted back-office modules, never a department/project module and never the
-- '*' wildcard. "Back-office modules" = the modules flagged general (the
-- cross-cutting company screens: Dashboard, Access Control, Activity Log).
--
-- Enforced in the guard trigger (the DB boundary), so it holds no matter what the
-- UI does. System roles (admin, staff) stay exempt — admin keeps its wildcard.
--
-- Nothing to backfill: the only department-less roles today are the system roles
-- (admin, staff), which the guard skips. New HR job titles are the ones governed.

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

  -- System roles (admin, staff) are unrestricted; admin keeps its '*' wildcard.
  if v_system then
    return new;
  end if;

  -- Back Office role (plane 1): no department, so it may hold ONLY back-office
  -- (general) modules — never a department/project module, never the wildcard.
  if v_dept is null then
    if new.resource = '*' then
      raise exception 'Wildcard access is reserved for system roles';
    end if;
    if exists (
      select 1 from public.module_settings
      where module_id = new.resource and is_general
    ) then
      return new;
    end if;
    raise exception
      'Module "%" is not a back-office module. Back office job titles can only be granted back-office screens.',
      new.resource;
  end if;

  -- Department role: the '*' wildcard is reserved for global/system roles.
  if new.resource = '*' then
    raise exception 'Wildcard access is not allowed for a department role';
  end if;

  -- General (back-office) modules are grantable to any role.
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
