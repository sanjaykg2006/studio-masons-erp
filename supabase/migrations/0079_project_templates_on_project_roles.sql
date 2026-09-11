-- Studio-Masons ERP — the shared template library moves to project roles.
-- Run AFTER 0078_one_home_per_permission.sql.
--
-- WHAT CHANGES
--   "Project · Templates" (the brief question forms and the default project
--   checklist) leaves each department's People & Access page and is set per
--   project role in Settings -> Project roles, at the user's request.
--
--   Like Projects · Create (0078), it is a library, not work on one project, so
--   a project role grants it WHEREVER that role is held: on any project the
--   person is a member of, or on every project through the all-projects switch.
--
-- WHY A NEW FUNCTION
--   has_permission() reads only job-title and team grants, so a project role's
--   tick on project.template did nothing — Designer, Junior / Intern and Senior
--   Project Architect already have "View" ticked, and it has been inert. They
--   take effect here.
--
--   has_permission_anywhere() is that rule, written once. can_create_project()
--   (0078) was the same rule for one resource and becomes a wrapper over it.
--
-- WHO IS AFFECTED ON THE DAY THIS RUNS
--   * Anyone holding Designer, Junior / Intern or Senior Project Architect on a
--     project can now VIEW the shared template library.
--   * BETA 1's People & Access tick (View) is removed; they keep View only if
--     they hold one of those roles on a project.

-- ── 1. The rule, once ────────────────────────────────────────────────────────
create or replace function public.has_permission_anywhere(
  p_resource text,
  p_action   public.app_action
)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.has_permission(p_resource, p_action)
    or exists (
      select 1
      from public.project_members m
      join public.role_permissions rp on rp.role_id = m.role_id
      where m.user_id = auth.uid()
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

create or replace function public.can_create_project()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.has_permission_anywhere('project', 'create');
$$;

-- ── 2. The shared library's rows follow it ───────────────────────────────────
-- Department-owned (Design) templates keep design.template, a People & Access
-- tick, exactly as before.
create or replace function public.can_read_template_version(p_version uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    -- (a) via the template library, matching the 0019 scope rule.
    exists (
      select 1
      from public.design_template_versions v
      join public.design_templates t on t.id = v.template_id
      where v.id = p_version
        and (
          (t.department_id is null
             and public.has_permission_anywhere('project.template', 'read'))
          or (t.department_id is not null
             and public.has_permission('design.template', 'read'))
        )
    )
    -- (b) or because a brief built on it is one the caller may read.
    or exists (
      select 1
      from public.project_briefs b
      where b.template_version_id = p_version
        and public.has_project_permission(b.project_id, 'project.brief', 'read')
    );
$$;

drop policy if exists "design_templates_select" on public.design_templates;
create policy "design_templates_select" on public.design_templates
  for select using (
    (department_id is null and has_permission_anywhere('project.template', 'read'))
    or (department_id is not null and has_permission('design.template', 'read'))
    or can_read_template(id)
  );

drop policy if exists "design_templates_insert" on public.design_templates;
create policy "design_templates_insert" on public.design_templates
  for insert with check (
    (department_id is null and has_permission_anywhere('project.template', 'create'))
    or (department_id is not null and has_permission('design.template', 'create'))
  );

drop policy if exists "design_templates_update" on public.design_templates;
create policy "design_templates_update" on public.design_templates
  for update using (
    (department_id is null and has_permission_anywhere('project.template', 'update'))
    or (department_id is not null and has_permission('design.template', 'update'))
  )
  with check (
    (department_id is null and has_permission_anywhere('project.template', 'update'))
    or (department_id is not null and has_permission('design.template', 'update'))
  );

drop policy if exists "design_templates_delete" on public.design_templates;
create policy "design_templates_delete" on public.design_templates
  for delete using (
    (department_id is null and has_permission_anywhere('project.template', 'delete'))
    or (department_id is not null and has_permission('design.template', 'delete'))
  );

-- The child tables were already a flat gate on either library (0019).
drop policy if exists "design_template_versions_write" on public.design_template_versions;
create policy "design_template_versions_write" on public.design_template_versions
  for all using (
    has_permission_anywhere('project.template', 'update')
    or has_permission('design.template', 'update')
  )
  with check (
    has_permission_anywhere('project.template', 'update')
    or has_permission('design.template', 'update')
  );

drop policy if exists "design_template_sections_write" on public.design_template_sections;
create policy "design_template_sections_write" on public.design_template_sections
  for all using (
    has_permission_anywhere('project.template', 'update')
    or has_permission('design.template', 'update')
  )
  with check (
    has_permission_anywhere('project.template', 'update')
    or has_permission('design.template', 'update')
  );

drop policy if exists "design_template_questions_write" on public.design_template_questions;
create policy "design_template_questions_write" on public.design_template_questions
  for all using (
    has_permission_anywhere('project.template', 'update')
    or has_permission('design.template', 'update')
  )
  with check (
    has_permission_anywhere('project.template', 'update')
    or has_permission('design.template', 'update')
  );

drop policy if exists "design_template_columns_write" on public.design_template_columns;
create policy "design_template_columns_write" on public.design_template_columns
  for all using (
    has_permission_anywhere('project.template', 'update')
    or has_permission('design.template', 'update')
  )
  with check (
    has_permission_anywhere('project.template', 'update')
    or has_permission('design.template', 'update')
  );

-- The company default checklist lives in the same library (0076).
drop policy if exists "project_step_templates_select" on public.project_step_templates;
create policy "project_step_templates_select" on public.project_step_templates
  for select using (has_permission_anywhere('project.template', 'read'));

drop policy if exists "project_step_templates_write" on public.project_step_templates;
create policy "project_step_templates_write" on public.project_step_templates
  for all using (has_permission_anywhere('project.template', 'update'))
  with check (has_permission_anywhere('project.template', 'update'));

-- ── 3. Remove the ticks that no longer have a home ───────────────────────────
delete from public.team_member_permissions where resource = 'project.template';
