-- Studio-Masons ERP — Split templates: general (Projects) vs dept-owned (Design)
-- Run in the Supabase SQL Editor / via db:push AFTER 0018_projects_module.sql.
-- ⚠️  Back up first (npm run db:backup).
--
-- The single questionnaire library becomes SCOPED by department_id:
--   * NULL         = a GENERAL, company-wide template — managed in the Projects
--                    module (resource project.template), usable at any point in a
--                    project (briefs are one use).
--   * a department = that department's OWN template (Design first, design.template).
-- Existing rows -> general (NULL), per the product decision ("current -> Projects").
-- (The tables keep their design_* names for now — an internal detail, like the
-- rest of the project code still living under src/modules/design; renamed later.)

-- 1. Scope column. Existing rows default to NULL = general. --------------------
alter table public.design_templates
  add column if not exists department_id uuid references public.departments (id);

-- 2. Register the general-template resource (project.template). ----------------
insert into public.module_settings (module_id, is_general)
  values ('project.template', false)
on conflict (module_id) do nothing;
-- Grantable to Design's roles (they own the general library today). MUST run
-- before the grant copy below, so the guard_role_permission trigger accepts it.
insert into public.department_modules (department_id, module_id)
  select id, 'project.template' from public.departments where key = 'design'
on conflict do nothing;

-- 3. Carry existing design.template grants over to project.template. -----------
-- The current library is now GENERAL, so whoever managed it keeps managing it via
-- project.template. The design.template grants stay, now governing Design's OWN
-- (initially empty) library.
insert into public.role_permissions (role_id, resource, action)
  select role_id, 'project.template', action
  from public.role_permissions where resource = 'design.template'
on conflict do nothing;
insert into public.team_member_permissions (department_id, user_id, resource, action)
  select department_id, user_id, 'project.template', action
  from public.team_member_permissions where resource = 'design.template'
on conflict do nothing;

-- 4. Scope-aware RLS on the templates table. ----------------------------------
drop policy if exists "design_templates_select" on public.design_templates;
create policy "design_templates_select" on public.design_templates
  for select using (
    (department_id is null     and has_permission('project.template', 'read'))
    or (department_id is not null and has_permission('design.template', 'read'))
  );
drop policy if exists "design_templates_insert" on public.design_templates;
create policy "design_templates_insert" on public.design_templates
  for insert with check (
    (department_id is null     and has_permission('project.template', 'create'))
    or (department_id is not null and has_permission('design.template', 'create'))
  );
drop policy if exists "design_templates_update" on public.design_templates;
create policy "design_templates_update" on public.design_templates
  for update using (
    (department_id is null     and has_permission('project.template', 'update'))
    or (department_id is not null and has_permission('design.template', 'update'))
  )
  with check (
    (department_id is null     and has_permission('project.template', 'update'))
    or (department_id is not null and has_permission('design.template', 'update'))
  );
drop policy if exists "design_templates_delete" on public.design_templates;
create policy "design_templates_delete" on public.design_templates
  for delete using (
    (department_id is null     and has_permission('project.template', 'delete'))
    or (department_id is not null and has_permission('design.template', 'delete'))
  );

-- 5. Children (versions/columns/sections/questions): flat gate on EITHER
--    template resource. The scope-precise gate lives on the parent template row
--    (and on briefs); children are just structure, so a flat read/update is fine.
do $$
declare t text;
begin
  foreach t in array array[
    'design_template_versions',
    'design_template_columns',
    'design_template_sections',
    'design_template_questions'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select using (has_permission(''project.template'', ''read'') or has_permission(''design.template'', ''read''))',
      t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format(
      'create policy %I on public.%I for all using (has_permission(''project.template'', ''update'') or has_permission(''design.template'', ''update'')) with check (has_permission(''project.template'', ''update'') or has_permission(''design.template'', ''update''))',
      t || '_write', t);
  end loop;
end $$;
