-- Studio-Masons ERP — a brief you may read must include the template behind it
-- Run AFTER 0067_vendor_details_on_po.sql.
--
-- THE BUG
--   Opening a brief 404'd ("this page doesn't exist or may have moved") for
--   anyone who wasn't a Design-template reader — which is nearly every ordinary
--   project member.
--
--   A brief is only questions + answers; its actual shape (sections, questions,
--   columns) lives in the template VERSION it was built from. The brief page
--   loads that version, and if it comes back empty the page treats the brief as
--   missing and 404s. Two separate gaps made it come back empty:
--
--   1. 0019 made the templates table scope-aware (a global/company template is
--      read with `project.template:read`, a department one with
--      `design.template:read`) but left its four CHILD tables on the old 0006
--      rule — `design.template:read` only. So someone granted the global
--      template library could see a template row and none of its contents.
--
--   2. Neither rule helps a plain project member at all. Their grants come from
--      their PROJECT role, and template reads are checked department-wide, so
--      they were never going to pass. Yet they can legitimately read the brief.
--
-- THE RULE THIS ESTABLISHES
--   You may read a template version (and its columns, sections and questions)
--   if you may read the template library it belongs to, OR if it is the version
--   behind a brief you are already allowed to read. Reading a brief now reliably
--   includes reading the thing that gives that brief its shape.
--
--   This grants no new power: `project.brief:read` on that project was already
--   required, and it exposes only the questionnaire's structure, never another
--   project's answers.

-- 1. Can the caller read this template version? -------------------------------
-- SECURITY DEFINER so the policy can consult templates/briefs without tripping
-- over their own RLS (the same pattern as has_project_permission).
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
             and public.has_permission('project.template', 'read'))
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

-- Questions hang off sections, so they need the section's version first.
create or replace function public.can_read_template_section(p_section uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.can_read_template_version(
    (select version_id from public.design_template_sections where id = p_section)
  );
$$;

-- The parent row too, so the brief can show which template it came from.
create or replace function public.can_read_template(p_template uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.project_briefs b
    where b.template_id = p_template
      and public.has_project_permission(b.project_id, 'project.brief', 'read')
  );
$$;

-- 2. Re-point the read policies ------------------------------------------------
drop policy if exists "design_template_versions_select" on public.design_template_versions;
create policy "design_template_versions_select" on public.design_template_versions
  for select using (public.can_read_template_version(id));

drop policy if exists "design_template_columns_select" on public.design_template_columns;
create policy "design_template_columns_select" on public.design_template_columns
  for select using (public.can_read_template_version(version_id));

drop policy if exists "design_template_sections_select" on public.design_template_sections;
create policy "design_template_sections_select" on public.design_template_sections
  for select using (public.can_read_template_version(version_id));

drop policy if exists "design_template_questions_select" on public.design_template_questions;
create policy "design_template_questions_select" on public.design_template_questions
  for select using (public.can_read_template_section(section_id));

-- The templates table keeps its 0019 scope rule, plus the brief-backed route.
drop policy if exists "design_templates_select" on public.design_templates;
create policy "design_templates_select" on public.design_templates
  for select using (
    (department_id is null     and has_permission('project.template', 'read'))
    or (department_id is not null and has_permission('design.template', 'read'))
    or public.can_read_template(id)
  );

-- Write paths are untouched: editing the template library still needs
-- design.template:update / project.template:update as before.
