-- Studio-Masons ERP — fix: infinite recursion between tasks & task_invites
-- Run AFTER 0028_department_admin.sql.
--
-- THE PROBLEM
--   0023 gave the `tasks` table a visibility rule that peeks at `task_invites`
--   (to let invited people see a task), and gave `task_invites` rules that peek
--   back at `tasks` (to see who owns the task). Each table's rule triggers the
--   other's, so Postgres loops forever: "infinite recursion detected in policy
--   for relation tasks".
--
-- THE FIX
--   Move each cross-table peek into a SECURITY DEFINER helper. Such a function
--   runs as the table owner, which is exempt from row-level rules, so the loop
--   is broken. The visibility logic itself is unchanged.

-- 1. Helpers ------------------------------------------------------------------

-- Does the caller have an invite to this task? (reads task_invites without
-- re-triggering its row rules, breaking the loop with `tasks`).
create or replace function public.is_task_invitee(p_task uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.task_invites ti
    where ti.task_id = p_task and ti.user_id = auth.uid()
  );
$$;

-- May the caller MANAGE this task's invites? (creator / assignee / lead / admin)
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
        or public.is_department_lead(t.department_id)
        or public.has_permission('access', 'update')
      )
  );
$$;

-- May the caller SEE this task's invite list? (creator / lead / admin)
create or replace function public.can_view_task_invites(p_task uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task
      and (
        t.created_by = auth.uid()
        or public.is_department_lead(t.department_id)
        or public.has_permission('access', 'read')
      )
  );
$$;

-- 2. Re-write the tasks SELECT rule to use the helper -------------------------
drop policy if exists "tasks_select" on public.tasks;
create policy "tasks_select" on public.tasks
  for select using (
    public.on_department_team(department_id)
    and (
      subteam_id is null
      or public.can_see_subteam_work(subteam_id)
      or assignee_id = auth.uid()
      or created_by  = auth.uid()
      or public.is_task_invitee(id)
    )
  );

-- 3. Re-write the task_invites rules to use the helpers -----------------------
drop policy if exists "task_invites_select" on public.task_invites;
create policy "task_invites_select" on public.task_invites
  for select using (
    user_id = auth.uid()
    or public.can_view_task_invites(task_id)
  );

drop policy if exists "task_invites_write" on public.task_invites;
create policy "task_invites_write" on public.task_invites
  for all using (public.can_manage_task(task_id))
  with check (public.can_manage_task(task_id));
