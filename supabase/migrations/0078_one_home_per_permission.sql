-- Studio-Masons ERP — every permission has exactly one home.
-- Run AFTER 0077_folders_are_project_wide.sql.
--
-- WHAT WAS WRONG
--   Three screens hand out access, and some powers could be set on two of them:
--
--   * "Projects" appeared on a department's People & Access page (Create) AND on
--     its Project roles matrix (View/Create/Edit/Approve/Delete). The Project
--     roles "Create" tick did nothing at all — can_create checked only job title
--     and team grants — yet two Project Management roles had it ticked.
--   * Petty Cash was flagged back-office (Access Control job titles) AND allotted
--     to all four departments (each People & Access page).
--   * Nothing a department does internally — its task board, its settings, who
--     runs its people — could be handed to anyone but the lead.
--
-- THE RULE FROM NOW ON
--   Access Control (job titles) ... company-wide screens, incl. Petty Cash.
--   People & Access (per person) .. the department's own work: Tasks, Settings,
--                                   People & Access, and its own tools (template
--                                   libraries, vendor list, company assets,
--                                   billing branches).
--   Settings -> Project roles ..... everything done on a project, including
--                                   Projects · Create = may start new projects.
--
--   The department lead holds Tasks, Settings and People & Access automatically
--   and may tick them for others. Handing out Settings or People & Access stays
--   with the lead (or HR), so a delegate cannot pass on more than they were given.
--
-- WHO IS AFFECTED ON THE DAY THIS RUNS
--   * Prem Kumar's People & Access "Projects · Create" tick is removed. He keeps
--     the ability: his every-project role, Project Director, has Create ticked.
--   * Petty Cash ticks on People & Access are removed. Prem Kumar (Director) and
--     BETA 1 (Staff) already hold the same via their job title, except BETA 1's
--     "Petty Cash · Categories: View", which is dropped.
--   * The Project Director and SITE ENGINEER "Projects · Create" ticks start
--     working: anyone holding those roles on a project may now start projects.

-- ── 1. The department's own abilities ────────────────────────────────────────
-- Built into every department; no module needs allotting. Mirrored in the app
-- registry by `everyDepartment: true` (src/modules/departments/index.ts).
create or replace function public.is_department_ability(p_resource text)
returns boolean
language sql immutable set search_path = public
as $$
  select p_resource in ('department.tasks', 'department.settings', 'department.people');
$$;

-- A person's own tick in ONE department. has_permission() unions team grants
-- across every department, so department-scoped abilities must use this.
create or replace function public.has_team_permission(
  p_dept     uuid,
  p_resource text,
  p_action   public.app_action
)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.team_member_permissions tmp
    where tmp.department_id = p_dept
      and tmp.user_id = auth.uid()
      and tmp.resource = p_resource
      and tmp.action = p_action
  );
$$;

-- People & Access: the lead, HR, or someone the lead has given it to.
create or replace function public.can_manage_team(p_dept uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.has_permission('access', 'update')
      or public.is_department_lead(p_dept)
      or public.has_team_permission(p_dept, 'department.people', 'manage');
$$;

-- Settings (project roles, folder access): the lead, HR, or a delegate.
create or replace function public.can_manage_department_roles(p_dept uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_department_lead(p_dept)
      or public.has_permission('access', 'update')
      or public.has_team_permission(p_dept, 'department.settings', 'manage');
$$;

-- Design's settings follow the same rule as every other department's. This was
-- design.folder:manage, which nobody held, so a Design lead could open the
-- settings page (0075) but every save was refused.
create or replace function public.can_manage_design_roles()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.can_manage_department_roles(public.design_department_id());
$$;

-- Anyone who runs this department's People & Access or Settings needs to READ
-- its roles, modules, team and sub-teams. Used by the read policies below.
create or replace function public.manages_department(p_dept uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_department_lead(p_dept)
      or public.has_team_permission(p_dept, 'department.people', 'manage')
      or public.has_team_permission(p_dept, 'department.settings', 'manage');
$$;

create or replace function public.manages_any_department()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.leads_any_department()
      or exists (
        select 1 from public.team_member_permissions
        where user_id = auth.uid()
          and action = 'manage'
          and resource in ('department.people', 'department.settings')
      );
$$;

-- Tasks: create (was lead-only) and manage anyone's task (edit / pause).
create or replace function public.can_create_task(p_dept uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_department_lead(p_dept)
      or public.has_permission('access', 'update')
      or public.has_team_permission(p_dept, 'department.tasks', 'create');
$$;

create or replace function public.can_manage_department_tasks(p_dept uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_department_lead(p_dept)
      or public.has_permission('access', 'update')
      or public.has_team_permission(p_dept, 'department.tasks', 'update');
$$;

-- ── 2. The workspace list says which of the two screens each person may open ─
drop function if exists public.my_departments();
create function public.my_departments()
returns table (
  id uuid, key text, label text,
  is_lead boolean, can_manage_people boolean, can_manage_settings boolean
)
language sql stable security definer set search_path = public
as $$
  select d.id, d.key, d.label,
         public.is_department_lead(d.id),
         public.can_manage_team(d.id),
         public.can_manage_department_roles(d.id)
  from public.departments d
  where public.is_department_lead(d.id)
     or public.has_permission('access', 'read')
     or exists (
       select 1 from public.team_members tm
       where tm.department_id = d.id and tm.user_id = auth.uid()
     )
  order by d.label;
$$;

grant execute on function public.my_departments() to authenticated;

-- ── 3. People & Access holds only the department's own abilities ─────────────
-- No more general (back-office) modules here: those belong to job titles.
create or replace function public.guard_team_member_permission()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.resource in ('*', 'access') then
    raise exception 'This power cannot be granted through a department';
  end if;
  if public.is_department_ability(new.resource) then
    return new;
  end if;
  if exists (
    select 1 from public.department_modules
    where department_id = new.department_id and module_id = new.resource
  ) then
    return new;
  end if;
  raise exception 'Module "%" is not available to this department', new.resource;
end;
$$;

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
  if p_resource in ('department.people', 'department.settings')
     and not (public.is_department_lead(p_dept) or public.has_permission('access', 'update'))
  then
    raise exception 'Only the department lead can hand out People & Access or Settings';
  end if;
  if not exists (
    select 1 from public.team_members
    where department_id = p_dept and user_id = p_user
  ) then
    raise exception 'Add this person to the team first';
  end if;
  if not public.is_department_ability(p_resource)
     and not exists (
       select 1 from public.department_modules
       where department_id = p_dept and module_id = p_resource
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

-- ── 4. Reads for the people who run a department ─────────────────────────────
create or replace function public.list_department_subteams(p_dept uuid)
returns table (id uuid, key text, label text, sort int)
language sql stable security definer set search_path = public
as $$
  select s.id, s.key, s.label, s.sort
  from public.department_subteams s
  where s.department_id = p_dept
    and (public.has_permission('access', 'read')
         or public.manages_department(p_dept)
         or public.can_create_task(p_dept))
  order by s.sort;
$$;

create or replace function public.list_department_team(p_dept uuid)
returns table (user_id uuid, full_name text, email text)
language sql stable security definer set search_path = public
as $$
  select tm.user_id, p.full_name, p.email
  from public.team_members tm
  join public.profiles p on p.id = tm.user_id
  where tm.department_id = p_dept
    and (public.has_permission('access', 'read')
         or public.manages_department(p_dept)
         or public.can_create_task(p_dept))
  order by p.full_name nulls last, p.email;
$$;

create or replace function public.list_subteam_members(p_dept uuid)
returns table (subteam_id uuid, user_id uuid)
language sql stable security definer set search_path = public
as $$
  select sm.subteam_id, sm.user_id
  from public.subteam_members sm
  join public.department_subteams s on s.id = sm.subteam_id
  where s.department_id = p_dept
    and (public.has_permission('access', 'read') or public.manages_department(p_dept));
$$;

drop policy if exists "department_modules_read" on public.department_modules;
create policy "department_modules_read" on public.department_modules
  for select using (
    has_permission('access', 'read') or manages_department(department_id)
  );

drop policy if exists "department_subteams_read" on public.department_subteams;
create policy "department_subteams_read" on public.department_subteams
  for select using (
    has_permission('access', 'read') or manages_department(department_id)
  );

drop policy if exists "departments_read" on public.departments;
create policy "departments_read" on public.departments
  for select using (
    has_permission('access', 'read') or manages_department(id)
  );

drop policy if exists "roles_read" on public.roles;
create policy "roles_read" on public.roles
  for select using (
    has_permission('access', 'read')
    or (department_id is not null and manages_department(department_id))
  );

drop policy if exists "role_permissions_read" on public.role_permissions;
create policy "role_permissions_read" on public.role_permissions
  for select using (
    has_permission('access', 'read')
    or exists (
      select 1 from public.roles r
      where r.id = role_permissions.role_id
        and r.department_id is not null
        and manages_department(r.department_id)
    )
  );

drop policy if exists "subteam_members_read" on public.subteam_members;
create policy "subteam_members_read" on public.subteam_members
  for select using (
    user_id = auth.uid()
    or exists (
      select 1 from public.department_subteams s
      where s.id = subteam_members.subteam_id
        and (has_permission('access', 'read') or manages_department(s.department_id))
    )
  );

drop policy if exists "team_members_read" on public.team_members;
create policy "team_members_read" on public.team_members
  for select using (
    has_permission('access', 'read')
    or manages_department(department_id)
    or user_id = auth.uid()
  );

drop policy if exists "team_member_permissions_read" on public.team_member_permissions;
create policy "team_member_permissions_read" on public.team_member_permissions
  for select using (
    has_permission('access', 'read')
    or manages_department(department_id)
    or user_id = auth.uid()
  );

drop policy if exists "profiles_lead_select" on public.profiles;
create policy "profiles_lead_select" on public.profiles
  for select using (manages_any_department());

drop policy if exists "module_settings_read" on public.module_settings;
create policy "module_settings_read" on public.module_settings
  for select using (
    has_permission('access', 'read') or manages_any_department()
  );

drop policy if exists "design_folder_access_select" on public.design_folder_access;
create policy "design_folder_access_select" on public.design_folder_access
  for select using (
    has_permission('access', 'read') or manages_any_department() or has_design_access()
  );

drop policy if exists "design_folder_access_write" on public.design_folder_access;
create policy "design_folder_access_write" on public.design_folder_access
  for all using (
    has_permission('design.folder', 'manage') or can_manage_design_roles()
  )
  with check (
    has_permission('design.folder', 'manage') or can_manage_design_roles()
  );

-- ── 5. Tasks follow the new ticks ────────────────────────────────────────────
drop policy if exists "tasks_insert" on public.tasks;
create policy "tasks_insert" on public.tasks
  for insert with check (
    public.can_create_task(department_id)
    and (
      subteam_id is null
      or public.can_see_subteam_work(subteam_id)
      or public.is_department_lead(department_id)
    )
  );

drop policy if exists "tasks_update" on public.tasks;
create policy "tasks_update" on public.tasks
  for update using (
    public.on_department_team(department_id)
    and (
      created_by = auth.uid()
      or assignee_id = auth.uid()
      or public.can_manage_department_tasks(department_id)
    )
  )
  with check (
    public.on_department_team(department_id)
    and (
      created_by = auth.uid()
      or assignee_id = auth.uid()
      or public.can_manage_department_tasks(department_id)
    )
  );

drop policy if exists "tasks_delete" on public.tasks;
create policy "tasks_delete" on public.tasks
  for delete using (
    created_by = auth.uid()
    or public.is_department_lead(department_id)
    or public.has_permission('access', 'update')
    or public.has_team_permission(department_id, 'department.tasks', 'delete')
  );

create or replace function public.can_manage_task(p_task uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task
      and (
        t.created_by  = auth.uid()
        or t.assignee_id = auth.uid()
        or public.can_manage_department_tasks(t.department_id)
      )
  );
$$;

create or replace function public.set_task_paused(p_task uuid, p_paused boolean)
returns timestamptz
language plpgsql security definer set search_path = public
as $$
declare
  v_dept    uuid;
  v_creator uuid;
  v_new     timestamptz;
begin
  select department_id, created_by into v_dept, v_creator
  from public.tasks
  where id = p_task;

  if v_dept is null then
    raise exception 'Task not found.';
  end if;

  if not (
       v_creator = auth.uid()
    or public.can_manage_department_tasks(v_dept)
  ) then
    raise exception 'Only the person who set the task can pause it.';
  end if;

  v_new := case when p_paused then now() else null end;
  update public.tasks set paused_at = v_new where id = p_task;
  return v_new;
end;
$$;

-- ── 6. Projects · Create on a project role now does what it says ─────────────
-- A person may start a new project if their job title allows it, or if they
-- hold a project role with Projects · Create — on any project, or on every
-- project through the all-projects switch.
create or replace function public.can_create_project()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.has_permission('project', 'create')
    or exists (
      select 1
      from public.project_members m
      join public.role_permissions rp on rp.role_id = m.role_id
      where m.user_id = auth.uid()
        and rp.action = 'create'
        and rp.resource in ('project', '*')
    )
    or exists (
      select 1
      from public.team_members tm
      join public.role_permissions rp on rp.role_id = tm.all_projects_role_id
      where tm.user_id = auth.uid()
        and tm.all_projects
        and rp.action = 'create'
        and rp.resource in ('project', '*')
    );
$$;

drop policy if exists "projects_insert" on public.projects;
create policy "projects_insert" on public.projects
  for insert with check (public.can_create_project());

-- ── 7. Petty Cash is company-wide: job titles only ───────────────────────────
insert into public.module_settings (module_id, is_general)
values ('pettycash.entry', true), ('pettycash.category', true)
on conflict (module_id) do update set is_general = true;

delete from public.department_modules where module_id like 'pettycash.%';

delete from public.role_permissions rp
using public.roles r
where r.id = rp.role_id
  and r.department_id is not null
  and not r.is_system
  and rp.resource like 'pettycash.%';

-- ── 8. Remove the ticks that no longer have a home ───────────────────────────
-- Petty Cash now lives on job titles; Projects on project roles.
delete from public.team_member_permissions
where resource like 'pettycash.%'
   or resource = 'project';
