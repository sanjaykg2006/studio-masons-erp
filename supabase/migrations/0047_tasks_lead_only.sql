-- Studio-Masons ERP — Only a department lead (or admin) may create tasks
-- Run AFTER 0046_project_membership_visibility.sql.
--
-- WHY
--   Task creation was open to any team member. The business rule is now: only the
--   department LEAD sets tasks (delegation from the top); everyone on the team can
--   still see their tasks and update the ones they created or are assigned. This
--   only changes INSERT — select/update/delete policies are untouched.

drop policy if exists "tasks_insert" on public.tasks;
create policy "tasks_insert" on public.tasks
  for insert with check (
    (public.is_department_lead(department_id) or public.has_permission('access', 'update'))
    -- A lead may file into any of their department's sub-teams.
    and (
      subteam_id is null
      or public.can_see_subteam_work(subteam_id)
      or public.is_department_lead(department_id)
    )
  );
