-- Studio-Masons ERP — "Sees all projects" seniors + role-based folder access
-- Run in the Supabase SQL Editor AFTER 0015_team_access.sql.
--
-- DECISION (with the user): folder/file access STAYS role-based (the settings
-- matrix keyed by project roles). A person who should work across EVERY project
-- gets a per-person switch on Team Access plus ONE project role that applies on
-- all projects. That role then drives BOTH their project permissions AND their
-- folder capability through the existing role-keyed matrix — no folder rework.
--
-- Team Access (per-person grants) is now for DEPARTMENT-LEVEL things only
-- (manage the template library, create projects, edit settings). Project + file
-- access comes from project roles: assigned per project, or via this switch.

-- 1. The switch + the chosen role ---------------------------------------------
alter table public.team_members
  add column if not exists all_projects boolean not null default false,
  add column if not exists all_projects_role_id uuid references public.roles (id);

-- 2. Project permission: add the "all projects" branch ------------------------
-- True if a back-office/team grant allows it (has_permission), OR the caller's
-- membership role on THIS project allows it, OR the caller is an "all projects"
-- team member whose chosen role allows it.
create or replace function public.has_project_permission(
  p_project  uuid,
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
    public.has_permission(p_resource, p_action)
    or exists (
      select 1
      from public.design_project_members m
      join public.role_permissions rp on rp.role_id = m.role_id
      where m.project_id = p_project
        and m.user_id = auth.uid()
        and rp.action = p_action
        and rp.resource in (p_resource, '*')
    )
    or exists (
      select 1
      from public.team_members tm
      join public.departments d on d.id = tm.department_id
      join public.role_permissions rp on rp.role_id = tm.all_projects_role_id
      where tm.user_id = auth.uid()
        and tm.all_projects
        and d.key = 'design'
        and rp.action = p_action
        and rp.resource in (p_resource, '*')
    );
$$;

-- 3. Folder capability: include the "all projects" role ----------------------
-- Stays role-based. The caller's capability on a folder is the highest of: admin
-- wildcard, the legacy department-wide role (kept for safety), the "all projects"
-- team role, and their membership role on this project — all matched against the
-- role-keyed design_folder_access matrix.
create or replace function public.design_folder_rank(
  p_project uuid,
  p_folder  text
)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select greatest(
    case when exists (
      select 1 from public.profiles p
      join public.role_permissions rp on rp.role_id = p.role_id
      where p.id = auth.uid() and rp.resource = '*'
    ) then 3 else 0 end,
    coalesce((
      select max(case fa.capability
                   when 'approve' then 3 when 'edit' then 2 when 'view' then 1 else 0 end)
      from public.design_folder_access fa
      where fa.folder_key = p_folder
        and fa.role_id in (
          select p.role_id
          from public.profiles p
          join public.roles r on r.id = p.role_id
          where p.id = auth.uid() and r.is_department_wide
          union
          select tm.all_projects_role_id
          from public.team_members tm
          join public.departments d on d.id = tm.department_id
          where tm.user_id = auth.uid()
            and tm.all_projects
            and d.key = 'design'
            and tm.all_projects_role_id is not null
          union
          select m.role_id
          from public.design_project_members m
          where m.project_id = p_project and m.user_id = auth.uid()
        )
    ), 0)
  );
$$;

-- 4. Set a person's "all projects" switch + chosen role ----------------------
create or replace function public.set_team_member_all_projects(
  p_dept uuid,
  p_user uuid,
  p_all  boolean,
  p_role uuid
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.can_manage_team(p_dept) then
    raise exception 'Not authorized to manage this team';
  end if;
  if not exists (
    select 1 from public.team_members where department_id = p_dept and user_id = p_user
  ) then
    raise exception 'Add this person to the team first';
  end if;
  if p_all and (
       p_role is null
       or not exists (
         select 1 from public.roles where id = p_role and department_id = p_dept
       )
     ) then
    raise exception 'Pick a project role for all-projects access';
  end if;

  update public.team_members
    set all_projects = p_all,
        all_projects_role_id = case when p_all then p_role else null end
  where department_id = p_dept and user_id = p_user;
end;
$$;
