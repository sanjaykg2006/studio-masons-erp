-- Studio-Masons ERP — Carve the Projects world out of the Design module (Step 2)
-- Run in the Supabase SQL Editor / via db:push AFTER 0017_lint_hardening.sql.
-- ⚠️  Back up first (npm run db:backup): this renames live tables and migrates
--     permission grants. It is written to be re-runnable and non-destructive.
--
-- WHAT & WHY
--   Today "projects" live inside the Design module (design_projects, briefs,
--   folders, files, change orders) and are gated by design.project / design.brief
--   / design.member. Per the architecture plan, projects are a COMPANY-WIDE
--   Projects world worked by several department teams; Design becomes a plain
--   department module (its templates + folder/stage/role SETTINGS stay design.*).
--
--   So we:
--     1. Rename the project-world tables design_*  ->  projects / project_*.
--     2. Rename the permission resources design.project/brief/member -> project /
--        project.brief / project.member (grants, dept modules, module settings).
--     3. Tag each project with a department_id (existing rows -> Design).
--     4. Add PER-DEPARTMENT membership control: a project has teams from several
--        departments and each department's lead (or a project role with
--        project.member:manage in that department) manages ONLY their own team's
--        rows — enforced by can_manage_project_member() in the members RLS.
--     5. Recreate every policy/function that referenced an old name or literal
--        (a renamed table keeps its policies, but function bodies and resource
--        literals inside them do not update themselves — so we replace them).
--
--   design.template and design.folder (the template library + folder catalogue /
--   stage checklist / project-role SETTINGS) stay with the Design department.

-- 1. Rename the project-world tables ------------------------------------------
-- FKs and indexes follow the rename automatically; attached policies stay
-- attached (recreated below only where their bodies referenced old names).
do $$ begin
  if to_regclass('public.design_projects')        is not null then alter table public.design_projects        rename to projects;                end if;
  if to_regclass('public.design_project_members') is not null then alter table public.design_project_members rename to project_members;         end if;
  if to_regclass('public.design_briefs')          is not null then alter table public.design_briefs          rename to project_briefs;          end if;
  if to_regclass('public.design_brief_answers')   is not null then alter table public.design_brief_answers   rename to project_brief_answers;    end if;
  if to_regclass('public.design_files')           is not null then alter table public.design_files           rename to project_files;           end if;
  if to_regclass('public.design_change_requests') is not null then alter table public.design_change_requests rename to project_change_requests; end if;
  if to_regclass('public.design_project_steps')   is not null then alter table public.design_project_steps   rename to project_steps;           end if;
end $$;

-- 2. Tag projects with their owning department (existing rows -> Design) -------
alter table public.projects
  add column if not exists department_id uuid references public.departments (id);
update public.projects
  set department_id = (select id from public.departments where key = 'design')
  where department_id is null;

-- 3. Migrate the permission resource ids --------------------------------------
-- Every place a resource/module id is stored: the general/back-office flags, the
-- department<->module map, then role grants and per-person team grants. ORDER
-- MATTERS: the guard_role_permission trigger validates a role grant against
-- module_settings + department_modules, so those must be renamed BEFORE the
-- role_permissions rows, or the guard rejects the not-yet-registered 'project'.
-- The project.* modules stay assigned to the Design department here, so Design's
-- project roles keep working; add them to another department's modules when it
-- starts running projects.
update public.module_settings         set module_id = 'project'        where module_id = 'design.project';
update public.module_settings         set module_id = 'project.brief'  where module_id = 'design.brief';
update public.module_settings         set module_id = 'project.member' where module_id = 'design.member';
update public.department_modules      set module_id = 'project'        where module_id = 'design.project';
update public.department_modules      set module_id = 'project.brief'  where module_id = 'design.brief';
update public.department_modules      set module_id = 'project.member' where module_id = 'design.member';
update public.role_permissions        set resource  = 'project'        where resource  = 'design.project';
update public.role_permissions        set resource  = 'project.brief'  where resource  = 'design.brief';
update public.role_permissions        set resource  = 'project.member' where resource  = 'design.member';
update public.team_member_permissions set resource  = 'project'        where resource  = 'design.project';
update public.team_member_permissions set resource  = 'project.brief'  where resource  = 'design.brief';
update public.team_member_permissions set resource  = 'project.member' where resource  = 'design.member';

-- 4. Recreate functions that referenced renamed tables / old literals ----------

-- The project-aware boundary: global grant (dept-wide, incl. team grants via
-- has_permission) OR membership role on THIS project OR an "all projects" senior.
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
        and rp.action = p_action
        and rp.resource in (p_resource, '*')
    );
$$;

-- The caller's effective verbs on one project (role ∪ membership ∪ team grants).
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
  where tmp.user_id = auth.uid();
$$;

-- The caller's highest folder capability on a project (0 none/1 view/2 edit/3
-- approve), matched against the design_folder_access matrix. Admin '*' wins.
create or replace function public.design_folder_rank(
  p_project uuid,
  p_folder  text
)
returns int
language sql stable security definer set search_path = public
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
          where tm.user_id = auth.uid()
            and tm.all_projects
            and tm.all_projects_role_id is not null
          union
          select m.role_id
          from public.project_members m
          where m.project_id = p_project and m.user_id = auth.uid()
        )
    ), 0)
  );
$$;

-- The project's current stage, derived from the checklist.
create or replace function public.design_project_stage(p_project uuid)
returns text
language sql stable security definer set search_path = public
as $$
  with ord as (
    select * from (values
      ('brief_concept',1),('client_review',2),('design_freeze',3),
      ('gfc_release',4),('site_execution',5)
    ) as s(stage, n)
  ),
  stats as (
    select ss.stage,
           count(*) as total,
           count(*) filter (where coalesce(ps.done, false)) as done
    from public.design_stage_steps ss
    left join public.project_steps ps
      on ps.step_id = ss.id and ps.project_id = p_project
    group by ss.stage
  )
  select coalesce(
    (select st.stage from stats st join ord o on o.stage = st.stage
      where st.total > 0 and st.done < st.total
      order by o.n limit 1),
    'site_execution');
$$;

-- The folders for a project with the caller's capability + lock state.
create or replace function public.design_project_folders(p_project uuid)
returns table (
  folder_key  text,
  label       text,
  sort        int,
  description text,
  rank        int,
  locked      boolean
)
language sql stable security definer set search_path = public
as $$
  select ft.key, ft.label, ft.sort, ft.description,
         public.design_folder_rank(p_project, ft.key),
         public.is_folder_locked(p_project, ft.key)
  from public.design_folder_types ft
  where public.has_project_permission(p_project, 'project', 'read')
  order by ft.sort;
$$;

-- Project member names for the members card (no global access:read needed).
create or replace function public.design_project_members_view(p_project uuid)
returns table (user_id uuid, full_name text, email text, role_id uuid)
language sql stable security definer set search_path = public
as $$
  select m.user_id, p.full_name, p.email, m.role_id
  from public.project_members m
  join public.profiles p on p.id = m.user_id
  where m.project_id = p_project
    and public.has_project_permission(p_project, 'project', 'read');
$$;

-- Candidate users for the "add member" picker (anyone who can manage membership).
create or replace function public.design_assignable_users()
returns table (id uuid, full_name text, email text)
language sql stable security definer set search_path = public
as $$
  select p.id, p.full_name, p.email
  from public.profiles p
  where public.has_permission('project.member', 'manage')
     or exists (
       select 1
       from public.project_members m
       join public.role_permissions rp on rp.role_id = m.role_id
       where m.user_id = auth.uid()
         and rp.action = 'manage'
         and rp.resource in ('project.member', '*')
     )
     or public.leads_any_department();
$$;

-- Project roles the caller may assign: roles of departments they can staff
-- (a department they lead, OR globally via project.member:manage).
create or replace function public.design_roles()
returns table (id uuid, label text)
language sql stable security definer set search_path = public
as $$
  select r.id, r.label
  from public.roles r
  join public.departments d on d.id = r.department_id
  where (
      public.has_permission('project.member', 'manage')
      or public.is_department_lead(d.id)
      or exists (
        select 1
        from public.project_members m
        join public.roles mr on mr.id = m.role_id
        join public.role_permissions rp on rp.role_id = m.role_id
        where m.user_id = auth.uid()
          and rp.action = 'manage'
          and rp.resource in ('project.member', '*')
          and mr.department_id = r.department_id
      )
    )
  order by r.label;
$$;

-- Keep an approved brief read-only for end users.
create or replace function public.guard_brief_answer_lock()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_status public.design_brief_status;
begin
  select status into v_status from public.project_briefs
  where id = coalesce(new.brief_id, old.brief_id);
  if v_status = 'approved' and auth.uid() is not null then
    raise exception 'This brief is approved and locked for editing';
  end if;
  return coalesce(new, old);
end;
$$;

-- Deleting a design project role is still blocked while it staffs any project.
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
  if exists (select 1 from public.project_members where role_id = p_role) then
    raise exception 'This role is assigned to project members. Reassign them first.';
  end if;

  delete from public.roles where id = p_role;  -- role_permissions cascade
end;
$$;

-- 5. Access-gate helpers for the two sidebar links ----------------------------

-- Projects link + /projects landing: any project:read grant (role or team) OR
-- membership on at least one project.
create or replace function public.has_project_access()
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    public.has_permission('project', 'read')
    or exists (
      select 1 from public.project_members m where m.user_id = auth.uid()
    );
$$;

-- Design department link + /design landing: the department's own screens
-- (template library, folder/stage/role settings).
create or replace function public.has_design_access()
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    public.has_permission('design.template', 'read')
    or public.has_permission('design.folder', 'read');
$$;

-- 6. Per-department membership control ----------------------------------------
-- May the caller add/remove a member holding role p_role on p_project? True if
-- they can manage membership globally, lead the role's department, OR hold a
-- project role in the SAME department granting project.member:manage.
create or replace function public.can_manage_project_member(
  p_project uuid,
  p_role    uuid
)
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    public.has_permission('project.member', 'manage')
    or public.is_department_lead((select department_id from public.roles where id = p_role))
    or exists (
      select 1
      from public.project_members m
      join public.roles r on r.id = m.role_id
      join public.role_permissions rp on rp.role_id = m.role_id
      where m.project_id = p_project
        and m.user_id = auth.uid()
        and rp.action = 'manage'
        and rp.resource in ('project.member', '*')
        and r.department_id = (select department_id from public.roles where id = p_role)
    );
$$;

-- 7. Recreate the RLS policies with the new resource literals ------------------

-- Projects.
drop policy if exists "design_projects_select" on public.projects;
drop policy if exists "projects_select"        on public.projects;
create policy "projects_select" on public.projects
  for select using (has_project_permission(id, 'project', 'read'));
drop policy if exists "design_projects_insert" on public.projects;
drop policy if exists "projects_insert"        on public.projects;
create policy "projects_insert" on public.projects
  for insert with check (has_permission('project', 'create'));
drop policy if exists "design_projects_update" on public.projects;
drop policy if exists "projects_update"        on public.projects;
create policy "projects_update" on public.projects
  for update using (
    has_project_permission(id, 'project', 'update')
    or has_project_permission(id, 'project', 'approve')
  )
  with check (
    has_project_permission(id, 'project', 'update')
    or has_project_permission(id, 'project', 'approve')
  );
drop policy if exists "design_projects_delete" on public.projects;
drop policy if exists "projects_delete"        on public.projects;
create policy "projects_delete" on public.projects
  for delete using (has_project_permission(id, 'project', 'delete'));

-- Members: read if you can see the project; write per-department (see §6).
drop policy if exists "design_members_select" on public.project_members;
drop policy if exists "project_members_select" on public.project_members;
create policy "project_members_select" on public.project_members
  for select using (has_project_permission(project_id, 'project', 'read'));
drop policy if exists "design_members_write" on public.project_members;
drop policy if exists "project_members_write" on public.project_members;
create policy "project_members_write" on public.project_members
  for all using (can_manage_project_member(project_id, role_id))
  with check (can_manage_project_member(project_id, role_id));

-- Briefs.
drop policy if exists "design_briefs_select" on public.project_briefs;
drop policy if exists "project_briefs_select" on public.project_briefs;
create policy "project_briefs_select" on public.project_briefs
  for select using (has_project_permission(project_id, 'project.brief', 'read'));
drop policy if exists "design_briefs_insert" on public.project_briefs;
drop policy if exists "project_briefs_insert" on public.project_briefs;
create policy "project_briefs_insert" on public.project_briefs
  for insert with check (has_project_permission(project_id, 'project.brief', 'create'));
drop policy if exists "design_briefs_update" on public.project_briefs;
drop policy if exists "project_briefs_update" on public.project_briefs;
create policy "project_briefs_update" on public.project_briefs
  for update using (
    has_project_permission(project_id, 'project.brief', 'update')
    or has_project_permission(project_id, 'project.brief', 'review')
    or has_project_permission(project_id, 'project.brief', 'approve')
  )
  with check (
    has_project_permission(project_id, 'project.brief', 'update')
    or has_project_permission(project_id, 'project.brief', 'review')
    or has_project_permission(project_id, 'project.brief', 'approve')
  );
drop policy if exists "design_briefs_delete" on public.project_briefs;
drop policy if exists "project_briefs_delete" on public.project_briefs;
create policy "project_briefs_delete" on public.project_briefs
  for delete using (has_project_permission(project_id, 'project.brief', 'delete'));

-- Brief answers (inherit the brief's project context).
drop policy if exists "design_brief_answers_select" on public.project_brief_answers;
drop policy if exists "project_brief_answers_select" on public.project_brief_answers;
create policy "project_brief_answers_select" on public.project_brief_answers
  for select using (exists (
    select 1 from public.project_briefs b
    where b.id = brief_id
      and has_project_permission(b.project_id, 'project.brief', 'read')
  ));
drop policy if exists "design_brief_answers_write" on public.project_brief_answers;
drop policy if exists "project_brief_answers_write" on public.project_brief_answers;
create policy "project_brief_answers_write" on public.project_brief_answers
  for all using (exists (
    select 1 from public.project_briefs b
    where b.id = brief_id
      and has_project_permission(b.project_id, 'project.brief', 'update')
  ))
  with check (exists (
    select 1 from public.project_briefs b
    where b.id = brief_id
      and has_project_permission(b.project_id, 'project.brief', 'update')
  ));

-- Per-project checklist steps.
drop policy if exists "design_project_steps_select" on public.project_steps;
drop policy if exists "project_steps_select" on public.project_steps;
create policy "project_steps_select" on public.project_steps
  for select using (has_project_permission(project_id, 'project', 'read'));
drop policy if exists "design_project_steps_write" on public.project_steps;
drop policy if exists "project_steps_write" on public.project_steps;
create policy "project_steps_write" on public.project_steps
  for all using (has_project_permission(project_id, 'project', 'update'))
  with check (has_project_permission(project_id, 'project', 'update'));

-- Change orders.
drop policy if exists "design_change_requests_select" on public.project_change_requests;
drop policy if exists "project_change_requests_select" on public.project_change_requests;
create policy "project_change_requests_select" on public.project_change_requests
  for select using (has_project_permission(project_id, 'project', 'read'));
drop policy if exists "design_change_requests_insert" on public.project_change_requests;
drop policy if exists "project_change_requests_insert" on public.project_change_requests;
create policy "project_change_requests_insert" on public.project_change_requests
  for insert with check (has_project_permission(project_id, 'project', 'read'));
drop policy if exists "design_change_requests_update" on public.project_change_requests;
drop policy if exists "project_change_requests_update" on public.project_change_requests;
create policy "project_change_requests_update" on public.project_change_requests
  for update using (has_project_permission(project_id, 'project', 'approve'))
  with check (has_project_permission(project_id, 'project', 'approve'));

-- project_files policies are unchanged: they gate on has_folder_capability() /
-- is_folder_locked(), which carry over with the table rename. (Policy names keep
-- their "design_files_*" identifiers; harmless.)
