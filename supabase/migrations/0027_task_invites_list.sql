-- Studio-Masons ERP — task-board polish: list a task's invited viewers
-- Run AFTER 0026_project_management_dept.sql.
--
-- Supports the "share a task with a specific person" UI. Returns the people
-- deliberately let in to a task from outside its sub-team. Readable by anyone who
-- can manage the task (its creator/assignee, a department lead, or an admin).

create or replace function public.list_task_invites(p_task uuid)
returns table (user_id uuid, full_name text, email text)
language sql stable security definer set search_path = public
as $$
  select ti.user_id, p.full_name, p.email
  from public.task_invites ti
  join public.profiles p on p.id = ti.user_id
  where ti.task_id = p_task
    and exists (
      select 1 from public.tasks t
      where t.id = p_task
        and (
          t.created_by = auth.uid()
          or t.assignee_id = auth.uid()
          or public.is_department_lead(t.department_id)
          or public.has_permission('access', 'read')
        )
    )
  order by p.full_name nulls last, p.email;
$$;
