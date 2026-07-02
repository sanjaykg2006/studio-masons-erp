-- Studio-Masons ERP — tasks: start/end times, spanning calendar, document uploads
-- Run AFTER 0029_fix_task_recursion.sql.
--
-- WHAT THIS ADDS
--   * start_time / due_time on tasks so a task can carry a time of day as well as
--     a date (the calendar bar can then say "09:00 Drawing — Test User").
--   * task_attachments: files people attach to a task. Following the same pattern
--     as design files, the bytes live in a PRIVATE Storage bucket touched only by
--     the service role inside gated server actions; this metadata row is the
--     security boundary.
--   * can_see_task(): one helper that mirrors the tasks visibility rule, reused by
--     attachments (and safe from the recursion the tasks<->invites cycle caused).

-- 1. Times on a task ----------------------------------------------------------
alter table public.tasks add column if not exists start_time time;
alter table public.tasks add column if not exists due_time   time;

-- 2. "Can the caller see this task?" (SECURITY DEFINER: owner-exempt, so it can
--    read tasks without re-triggering the row rules — same trick as 0029.)
create or replace function public.can_see_task(p_task uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task
      and public.on_department_team(t.department_id)
      and (
        t.subteam_id is null
        or public.can_see_subteam_work(t.subteam_id)
        or t.assignee_id = auth.uid()
        or t.created_by  = auth.uid()
        or public.is_task_invitee(t.id)
      )
  );
$$;

-- 3. Attachments --------------------------------------------------------------
create table if not exists public.task_attachments (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid not null references public.tasks (id) on delete cascade,
  name         text not null,
  storage_path text not null,
  mime_type    text,
  size_bytes   bigint,
  uploaded_by  uuid references public.profiles (id) default auth.uid(),
  created_at   timestamptz not null default now()
);
create index if not exists task_attachments_task_idx on public.task_attachments (task_id);

alter table public.task_attachments enable row level security;

-- See a task's files if you can see the task.
drop policy if exists "task_attachments_select" on public.task_attachments;
create policy "task_attachments_select" on public.task_attachments
  for select using (public.can_see_task(task_id));

-- Attach a file if you can see the task.
drop policy if exists "task_attachments_insert" on public.task_attachments;
create policy "task_attachments_insert" on public.task_attachments
  for insert with check (public.can_see_task(task_id));

-- Remove a file: whoever uploaded it, or someone who manages the task.
drop policy if exists "task_attachments_delete" on public.task_attachments;
create policy "task_attachments_delete" on public.task_attachments
  for delete using (
    uploaded_by = auth.uid() or public.can_manage_task(task_id)
  );

-- 4. Private Storage bucket for the bytes (accessed via service role in actions).
insert into storage.buckets (id, name, public)
values ('task-docs', 'task-docs', false)
on conflict (id) do nothing;

-- 5. Attachment list RPC (SECURITY DEFINER so uploader names resolve) ----------
create or replace function public.list_task_attachments(p_task uuid)
returns table (
  id               uuid,
  name             text,
  mime_type        text,
  size_bytes       bigint,
  uploaded_by      uuid,
  uploaded_by_name text,
  created_at       timestamptz
)
language sql stable security definer set search_path = public
as $$
  select a.id, a.name, a.mime_type, a.size_bytes,
         a.uploaded_by, coalesce(p.full_name, p.email), a.created_at
  from public.task_attachments a
  left join public.profiles p on p.id = a.uploaded_by
  where a.task_id = p_task and public.can_see_task(p_task)
  order by a.created_at;
$$;

-- 6. Add the two new time columns to the task list RPC ------------------------
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
         t.created_by, t.created_at, t.done_at
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
