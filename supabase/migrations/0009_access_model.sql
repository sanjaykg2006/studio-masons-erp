-- Studio-Masons ERP — Membership-driven access + template approval
-- Run AFTER 0008_design_roles.sql.
--
-- DECISIONS (from the design HOD):
--   * Membership controls access. Only DEPARTMENT-WIDE roles (Director, Senior
--     Project Architect, admin) see every project. Every other role reaches a
--     project ONLY by being a member of it — remove the member, lose the access.
--   * Editing a brief template produces a draft; PUBLISHING it needs the
--     template "approve" verb (approval before it goes live).

-- 1. Flag the department-wide roles -----------------------------------------
alter table public.roles
  add column if not exists is_department_wide boolean not null default false;

update public.roles set is_department_wide = true
  where key in ('admin', 'design_director', 'design_senior_pa');

-- 2. Project-aware check: the GLOBAL-role branch now requires a department-wide
--    role. Project-scoped roles must be granted via membership.
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
    -- (a) department-wide: a global role flagged is_department_wide
    exists (
      select 1
      from public.profiles p
      join public.roles r on r.id = p.role_id
      join public.role_permissions rp on rp.role_id = p.role_id
      where p.id = auth.uid()
        and r.is_department_wide
        and rp.action = p_action
        and rp.resource in (p_resource, '*')
    )
    -- (b) project-scoped: granted via the caller's membership on THIS project
    or exists (
      select 1
      from public.design_project_members m
      join public.role_permissions rp on rp.role_id = m.role_id
      where m.project_id = p_project
        and m.user_id = auth.uid()
        and rp.action = p_action
        and rp.resource in (p_resource, '*')
    );
$$;

-- 3. The caller's effective verbs on one project — same rule: department-wide
--    global grants ∪ membership grants.
create or replace function public.my_project_permissions(p_project uuid)
returns table (resource text, action public.app_action)
language sql
stable
security definer
set search_path = public
as $$
  select rp.resource, rp.action
  from public.profiles p
  join public.roles r on r.id = p.role_id
  join public.role_permissions rp on rp.role_id = p.role_id
  where p.id = auth.uid() and r.is_department_wide
  union
  select rp.resource, rp.action
  from public.design_project_members m
  join public.role_permissions rp on rp.role_id = m.role_id
  where m.project_id = p_project and m.user_id = auth.uid();
$$;

-- 4. Does the caller belong to the Design module at all? Drives the sidebar
--    link and the /design landing page for members who have no global grant.
create or replace function public.has_design_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1
      from public.profiles p
      join public.roles r on r.id = p.role_id
      join public.role_permissions rp on rp.role_id = p.role_id
      where p.id = auth.uid()
        and r.is_department_wide
        and rp.action = 'read'
        and rp.resource in ('design.project', '*')
    )
    or exists (
      select 1 from public.design_project_members m where m.user_id = auth.uid()
    );
$$;

-- 5. Publishing a template version may be done by holders of template "approve"
--    (not just "update"), so approval can be separated from editing.
drop policy if exists "design_template_versions_write" on public.design_template_versions;
create policy "design_template_versions_write" on public.design_template_versions
  for all using (
    has_permission('design.template', 'update')
    or has_permission('design.template', 'approve')
  )
  with check (
    has_permission('design.template', 'update')
    or has_permission('design.template', 'approve')
  );
