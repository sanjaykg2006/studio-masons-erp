-- Studio-Masons ERP — Self-service Design project roles + their permission matrix
-- Run in the Supabase SQL Editor AFTER 0012_design_files_changes.sql.
--
-- WHY: project roles (Director, Designer, Junior, ...) were seeded in SQL (0008),
-- so adding or tweaking one needed a developer. This lets a Design settings
-- manager create, delete, and edit those roles' permissions from INSIDE the ERP
-- — on the /design/settings "Project roles" matrix, which works exactly like the
-- Access Control matrix. A new role flows straight into the project "add member"
-- picker (it is a Design-department role, which design_roles() already returns).
--
-- WHO MAY DO IT: anyone who can manage Design settings — has_permission(
-- 'design.folder','manage') — the same gate that guards the settings page.
--
-- ENFORCEMENT: every write goes through a SECURITY DEFINER RPC that re-checks
-- that permission and confines the change to the Design department's OWN roles
-- and modules. We never widen the access:* RLS on roles / role_permissions; the
-- 0004 guard trigger still validates that a granted module belongs to the
-- department. This keeps each plane independent and DB-enforced.

-- 1. Helpers ------------------------------------------------------------------

-- May the caller manage Design role configuration?
create or replace function public.can_manage_design_roles()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.has_permission('design.folder', 'manage');
$$;

-- The Design department's id (keeps the RPCs short).
create or replace function public.design_department_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select id from public.departments where key = 'design';
$$;

-- 2. Reads — the settings editor's data ---------------------------------------

-- All Design roles, for the editor's role list. Broader than design_roles()
-- (which is the member-picker view): this is gated on the settings permission.
create or replace function public.design_settings_roles()
returns table (id uuid, key text, label text, description text, is_system boolean)
language sql stable security definer set search_path = public
as $$
  select r.id, r.key, r.label, r.description, r.is_system
  from public.roles r
  where r.department_id = public.design_department_id()
    and public.can_manage_design_roles()
  order by r.is_system desc, r.label;
$$;

-- Those roles' grants, so the matrix can tick the right cells.
create or replace function public.design_settings_role_permissions()
returns table (role_id uuid, resource text, action public.app_action)
language sql stable security definer set search_path = public
as $$
  select rp.role_id, rp.resource, rp.action
  from public.role_permissions rp
  join public.roles r on r.id = rp.role_id
  where r.department_id = public.design_department_id()
    and public.can_manage_design_roles();
$$;

-- 3. Writes — create / delete / set a grant -----------------------------------

-- Create a new Design project role. Key is a 'design_'-prefixed slug of the
-- label (kept recognisable + unlikely to collide with other departments').
create or replace function public.create_design_role(p_label text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id   uuid;
  v_key  text;
  v_slug text;
begin
  if not public.can_manage_design_roles() then
    raise exception 'Not authorized to manage design roles';
  end if;

  v_slug := regexp_replace(lower(trim(coalesce(p_label, ''))), '[^a-z0-9]+', '_', 'g');
  v_slug := regexp_replace(v_slug, '^_+|_+$', '', 'g');
  if v_slug = '' then
    raise exception 'Enter a role name';
  end if;
  v_key := 'design_' || v_slug;

  insert into public.roles (key, label, department_id, is_system)
  values (v_key, trim(p_label), public.design_department_id(), false)
  returning id into v_id;

  return v_id;
end;
$$;

-- Delete a Design role. Blocked for system roles and for roles still assigned to
-- any project member (the FK would fail anyway — this gives a clear message).
create or replace function public.delete_design_role(p_role uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.can_manage_design_roles() then
    raise exception 'Not authorized to manage design roles';
  end if;
  if not exists (
    select 1 from public.roles
    where id = p_role
      and department_id = public.design_department_id()
      and is_system = false
  ) then
    raise exception 'This role cannot be deleted';
  end if;
  if exists (select 1 from public.design_project_members where role_id = p_role) then
    raise exception 'This role is assigned to project members. Reassign them first.';
  end if;

  delete from public.roles where id = p_role;  -- role_permissions cascade
end;
$$;

-- Grant (p_grant = true) or revoke a single (resource, action) on a Design role
-- — one matrix cell. The 0004 guard trigger still checks the module belongs to
-- the Design department, so an off-department resource is rejected.
create or replace function public.set_design_role_permission(
  p_role     uuid,
  p_resource text,
  p_action   public.app_action,
  p_grant    boolean
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.can_manage_design_roles() then
    raise exception 'Not authorized to manage design roles';
  end if;
  if not exists (
    select 1 from public.roles
    where id = p_role and department_id = public.design_department_id()
  ) then
    raise exception 'Unknown design role';
  end if;

  if p_grant then
    insert into public.role_permissions (role_id, resource, action)
    values (p_role, p_resource, p_action)
    on conflict do nothing;
  else
    delete from public.role_permissions
    where role_id = p_role and resource = p_resource and action = p_action;
  end if;
end;
$$;
