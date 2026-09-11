-- Studio-Masons ERP — change orders get their own permission row.
-- Run AFTER 0086_module_homes.sql.
--
-- WHAT WAS WRONG
--   The Change Order Register had no row in any permission matrix. Raising a
--   change order needed only project:read (anyone who can see the project), and
--   approving or rejecting one needed project:approve — the same tick that
--   finalises and freezes a project. So approval could not be given on its own.
--
-- WHAT CHANGES
--   A new resource, project.change ("Project · Change orders"): View (read) the
--   register, Create (raise) a change order, Approve (approve or reject). It is
--   set per project role on each department's Settings → Project roles by
--   default, and may be moved to People & Access on Access Control → Where each
--   module is set. It is allotted to every department that works on projects.
--
-- NOBODY LOSES ANYTHING ON THE DAY THIS RUNS
--   Every role with project:read gets View + Create (they could see and raise
--   change orders before); every role with project:approve gets Approve (today:
--   Design's Designer). Adjust them per role from there.

insert into public.module_settings (module_id, home)
values ('project.change', 'project')
on conflict (module_id) do update set home = excluded.home;

-- Allot it wherever projects are worked (before the grants — the role guard
-- only accepts modules allotted to the role's department).
insert into public.department_modules (department_id, module_id)
select distinct dm.department_id, 'project.change'
from public.department_modules dm
where dm.module_id = 'project'
on conflict do nothing;

insert into public.role_permissions (role_id, resource, action)
select rp.role_id, 'project.change', x.action::public.app_action
from public.role_permissions rp
join public.roles r on r.id = rp.role_id
cross join (values ('read'), ('create')) as x(action)
where rp.resource = 'project' and rp.action = 'read'
  and r.department_id is not null and not r.is_system
on conflict do nothing;

insert into public.role_permissions (role_id, resource, action)
select rp.role_id, 'project.change', 'approve'
from public.role_permissions rp
join public.roles r on r.id = rp.role_id
where rp.resource = 'project' and rp.action = 'approve'
  and r.department_id is not null and not r.is_system
on conflict do nothing;

-- The register now asks for its own ticks.
drop policy if exists "project_change_requests_select" on public.project_change_requests;
create policy "project_change_requests_select" on public.project_change_requests
  for select using (
    can_view_project(project_id)
    and has_project_permission(project_id, 'project.change', 'read')
  );

drop policy if exists "project_change_requests_insert" on public.project_change_requests;
create policy "project_change_requests_insert" on public.project_change_requests
  for insert with check (
    can_view_project(project_id)
    and has_project_permission(project_id, 'project.change', 'create')
  );

drop policy if exists "project_change_requests_update" on public.project_change_requests;
create policy "project_change_requests_update" on public.project_change_requests
  for update using (has_project_permission(project_id, 'project.change', 'approve'))
  with check (has_project_permission(project_id, 'project.change', 'approve'));
