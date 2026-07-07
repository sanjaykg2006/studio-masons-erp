-- Studio-Masons ERP — tasks: pause / resume (held by the assigner)
-- Run AFTER 0057_controlled_folder_access.sql.
--
-- WHAT THIS ADDS
--   A task can be put ON HOLD ("paused") and later resumed. Pausing is a
--   scheduling decision the ASSIGNER makes, not the person doing the work: only
--   the task's creator (who, per 0047, is always a department lead) or a lead /
--   admin may pause or resume. The assignee can still work the task but cannot
--   pause it.
--
--   `paused_at` is a timestamp (NULL = active/running, a time = paused since).
--   It's orthogonal to the To do / In progress / Done status, so a task keeps its
--   place on the board and simply carries a "Paused" flag while on hold.

-- 1. The flag -----------------------------------------------------------------
alter table public.tasks add column if not exists paused_at timestamptz;

-- 2. Pause / resume, gated to the assigner ------------------------------------
-- SECURITY DEFINER so the rule "only the assigner (creator) or a lead/admin" is
-- enforced in the database, not just in the UI. The general tasks UPDATE policy
-- would otherwise also let the assignee flip this column; routing pause through
-- this function keeps that decision with whoever set the task.
create or replace function public.set_task_paused(p_task uuid, p_paused boolean)
returns timestamptz
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_dept    uuid;
  v_creator uuid;
  v_new     timestamptz;
begin
  select department_id, created_by into v_dept, v_creator
  from public.tasks
  where id = p_task;

  if v_dept is null then
    raise exception 'Task not found.';
  end if;

  if not (
       v_creator = auth.uid()
    or public.is_department_lead(v_dept)
    or public.has_permission('access', 'update')
  ) then
    raise exception 'Only the person who set the task can pause it.';
  end if;

  v_new := case when p_paused then now() else null end;
  update public.tasks set paused_at = v_new where id = p_task;
  return v_new;
end;
$$;

-- 3. Surface paused_at in the task list RPC -----------------------------------
-- Drop first: we're widening the returned table, which CREATE OR REPLACE can't do.
drop function if exists public.list_department_tasks(uuid);
create or replace function public.list_department_tasks(p_dept uuid)
returns table (
  id            uuid,
  subteam_id    uuid,
  subteam_label text,
  project_id    uuid,
  project_name  text,
  title         text,
  description   text,
  status        public.task_status,
  assignee_id   uuid,
  assignee_name text,
  start_date    date,
  start_time    time,
  due_date      date,
  due_time      time,
  paused_at     timestamptz,
  created_by    uuid,
  created_at    timestamptz,
  done_at       timestamptz
)
language sql stable security definer set search_path = public
as $$
  select t.id, t.subteam_id, s.label, t.project_id, pr.name,
         t.title, t.description, t.status,
         t.assignee_id, coalesce(ap.full_name, ap.email),
         t.start_date, t.start_time, t.due_date, t.due_time,
         t.paused_at, t.created_by, t.created_at, t.done_at
  from public.tasks t
  left join public.department_subteams s on s.id = t.subteam_id
  left join public.projects pr on pr.id = t.project_id
  left join public.profiles ap on ap.id = t.assignee_id
  where t.department_id = p_dept
    and public.on_department_team(p_dept)
    and (
      t.subteam_id is null
      or public.can_see_subteam_work(t.subteam_id)
      or t.assignee_id = auth.uid()
      or t.created_by  = auth.uid()
      or public.is_task_invitee(t.id)
    )
  order by
    case t.status when 'todo' then 0 when 'in_progress' then 1 else 2 end,
    t.due_date nulls last,
    t.created_at;
$$;
