-- Studio-Masons ERP — Step 7: the Project Management (PM) department
-- Run AFTER 0025_rfi_system.sql.
--
-- WHAT THIS ADDS
--   A new department, Project Management, which takes over a project after the
--   Design Freeze (Execution phase). It's seeded so it works immediately:
--     * appears everywhere departments do (Team Access, the RFI target picker);
--     * the project features are made available to its roles;
--     * a starter seniority ladder of PM roles (PM Lead > Project Manager >
--       Coordinator) so it can be staffed on a project and answer/escalate RFIs.
--   Its own dedicated settings/pipeline screens are a later step; today PM is
--   configured the same way as any department (leads via Team Access; members via
--   a project's "add member").

-- 1. The department -----------------------------------------------------------
insert into public.departments (key, label, description, is_system)
values (
  'project_management',
  'Project Management',
  'Runs a project after the Design Freeze: coordination, the execution pipeline and delivery.',
  false
)
on conflict (key) do nothing;

-- 2. Make the project features available to PM's roles ------------------------
-- (The 0004 guard only lets a department role hold its own department's modules,
-- so this must exist before the grants below.)
insert into public.department_modules (department_id, module_id)
select d.id, m.module_id
from public.departments d
cross join (values ('project'), ('project.brief'), ('project.member')) as m(module_id)
where d.key = 'project_management'
on conflict do nothing;

-- 3. A starter seniority ladder of PM roles + their grants --------------------
do $$
declare v_dept uuid;
begin
  select id into v_dept from public.departments where key = 'project_management';
  if v_dept is null then return; end if;

  insert into public.roles (key, label, department_id, is_system, rank) values
    ('pm_lead',            'PM Lead',         v_dept, false, 1),
    ('pm_project_manager', 'Project Manager', v_dept, false, 2),
    ('pm_coordinator',     'Coordinator',     v_dept, false, 3)
  on conflict (key) do nothing;

  -- PM Lead: full run of a project.
  insert into public.role_permissions (role_id, resource, action)
  select r.id, x.resource, x.action::public.app_action
  from public.roles r
  cross join (values
    ('project','read'), ('project','update'), ('project','approve'),
    ('project.member','manage'),
    ('project.brief','read')
  ) as x(resource, action)
  where r.key = 'pm_lead'
  on conflict do nothing;

  -- Project Manager: run day-to-day, staff the team.
  insert into public.role_permissions (role_id, resource, action)
  select r.id, x.resource, x.action::public.app_action
  from public.roles r
  cross join (values
    ('project','read'), ('project','update'),
    ('project.member','manage'),
    ('project.brief','read')
  ) as x(resource, action)
  where r.key = 'pm_project_manager'
  on conflict do nothing;

  -- Coordinator: see the project and its brief.
  insert into public.role_permissions (role_id, resource, action)
  select r.id, x.resource, x.action::public.app_action
  from public.roles r
  cross join (values
    ('project','read'),
    ('project.brief','read')
  ) as x(resource, action)
  where r.key = 'pm_coordinator'
  on conflict do nothing;
end $$;
