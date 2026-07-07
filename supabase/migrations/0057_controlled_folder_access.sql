-- Studio-Masons ERP — Controlled Folder Access as a shareable department module.
-- Run AFTER 0056.
--
-- WHAT THIS ADDS
--   The controlled-folder ACCESS grid (folder × role → view/edit/approve) used to
--   be Design-only. This turns it into an allottable module ('folder.access',
--   declared on the Projects module in the registry) that an admin can hand to any
--   department under /access. When allotted, that department's settings page grows
--   its own folder-access grid whose COLUMNS are the department's project roles.
--
--   No new tables and NO change to enforcement: the access data still lives in
--   public.design_folder_access (keyed by role_id), and design_folder_rank() /
--   has_folder_capability() already grant a capability to anyone holding a matching
--   role (department-wide OR per-project membership), regardless of department. So
--   configuring, say, a Project Management role here immediately reaches its people.
--
--   This migration only adds:
--     1. the module registration (module_settings row, non-general),
--     2. two SECURITY DEFINER RPCs so a department LEAD (or access admin) can read
--        and edit the grid for THEIR department's roles — parallel to the
--        department_roles / set_department_role_permission RPCs in 0028.
--   Design's own /design/settings keeps its existing design.folder path untouched.

-- 1. Register the resource so it is tickable as a department module on /access.
insert into public.module_settings (module_id, is_general)
values ('folder.access', false)
on conflict (module_id) do nothing;

-- 2a. Read — a department's folder-access grid (its own roles only) -------------
create or replace function public.department_folder_access(p_dept uuid)
returns table (folder_key text, role_id uuid, capability text)
language sql stable security definer set search_path = public
as $$
  select fa.folder_key, fa.role_id, fa.capability
  from public.design_folder_access fa
  join public.roles r on r.id = fa.role_id
  where r.department_id = p_dept
    and public.can_manage_department_roles(p_dept);
$$;

-- 2b. Write — set/clear one cell of a department's folder-access grid -----------
--     Gated exactly like the roles matrix: the department's lead or an access
--     admin (admin '*' passes via can_manage_department_roles → access:update is
--     implied by the wildcard in has_permission). Also requires the role to belong
--     to the department AND the department to actually hold the folder.access
--     module (allotted in department_modules, or flagged general).
create or replace function public.set_department_folder_access(
  p_dept       uuid,
  p_folder     text,
  p_role       uuid,
  p_capability text   -- 'view' | 'edit' | 'approve', or null/'' to clear
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.can_manage_department_roles(p_dept) then
    raise exception 'Not authorized to manage this department''s folder access';
  end if;

  if not exists (
    select 1 from public.roles where id = p_role and department_id = p_dept
  ) then
    raise exception 'That role does not belong to this department';
  end if;

  if not exists (
    select 1 from public.department_modules dm
    where dm.department_id = p_dept and dm.module_id = 'folder.access'
    union
    select 1 from public.module_settings ms
    where ms.module_id = 'folder.access' and ms.is_general
  ) then
    raise exception 'This department does not have Controlled Folder Access';
  end if;

  if p_capability is null or p_capability = '' then
    delete from public.design_folder_access
    where folder_key = p_folder and role_id = p_role;
  else
    if p_capability not in ('view', 'edit', 'approve') then
      raise exception 'Invalid capability';
    end if;
    insert into public.design_folder_access (folder_key, role_id, capability)
    values (p_folder, p_role, p_capability)
    on conflict (folder_key, role_id) do update set capability = excluded.capability;
  end if;
end;
$$;
