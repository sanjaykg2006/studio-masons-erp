-- Studio-Masons ERP — Step 6: department task board + calendar
-- Run AFTER 0022_design_subteams.sql.
--
-- WHAT THIS ADDS
--   A per-department to-do board. A task belongs to a department, optionally to a
--   sub-team (Concept / Technical) and optionally to a project. It has an
--   assignee, a status, and start/due dates (the calendar reads the dates).
--
--   CONCEPT <-> TECHNICAL PRIVACY (the point of 0022): a task filed under a
--   sub-team is visible only to that sub-team, plus a senior override (department
--   lead / admin), plus anyone deliberately invited to the specific task, plus
--   its assignee/creator. A task with no sub-team is shared across the department.

-- 1. Vocabulary + tables ------------------------------------------------------
do $$ begin
  create type public.task_status as enum ('todo', 'in_progress', 'done');
exception when duplicate_object then null; end $$;

create table if not exists public.tasks (
  id            uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments (id) on delete cascade,
  subteam_id    uuid references public.department_subteams (id) on delete set null,
  project_id    uuid references public.projects (id) on delete set null,
  title         text not null,
  description   text,
  status        public.task_status not null default 'todo',
  assignee_id   uuid references public.profiles (id) on delete set null,
  start_date    date,
  due_date      date,
  created_by    uuid not null default auth.uid() references public.profiles (id),
  created_at    timestamptz not null default now(),
  done_at       timestamptz
);
create index if not exists tasks_department_idx on public.tasks (department_id);
create index if not exists tasks_project_idx    on public.tasks (project_id);
create index if not exists tasks_assignee_idx   on public.tasks (assignee_id);

-- People deliberately let in to a single task from outside its sub-team.
create table if not exists public.task_invites (
  task_id  uuid not null references public.tasks (id) on delete cascade,
  user_id  uuid not null references public.profiles (id) on delete cascade,
  added_by uuid references public.profiles (id) default auth.uid(),
  added_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

-- 2. Membership helper --------------------------------------------------------
-- Is the caller allowed into this department's internal work at all?
create or replace function public.on_department_team(p_dept uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
      select 1 from public.team_members tm
      where tm.department_id = p_dept and tm.user_id = auth.uid()
    )
    or public.is_department_lead(p_dept)
    or public.has_permission('access', 'read');
$$;

-- 3. RLS ----------------------------------------------------------------------
alter table public.tasks         enable row level security;
alter table public.task_invites  enable row level security;

-- See a task: on the department team AND allowed for its sub-team scope.
drop policy if exists "tasks_select" on public.tasks;
create policy "tasks_select" on public.tasks
  for select using (
    public.on_department_team(department_id)
    and (
      subteam_id is null
      or public.can_see_subteam_work(subteam_id)
      or assignee_id = auth.uid()
      or created_by  = auth.uid()
      or exists (
        select 1 from public.task_invites ti
        where ti.task_id = tasks.id and ti.user_id = auth.uid()
      )
    )
  );

-- Add a task: a team member, filed into a scope they belong to (or shared).
drop policy if exists "tasks_insert" on public.tasks;
create policy "tasks_insert" on public.tasks
  for insert with check (
    public.on_department_team(department_id)
    and (subteam_id is null or public.can_see_subteam_work(subteam_id))
  );

-- Edit a task: its creator or assignee, or a department lead / admin.
drop policy if exists "tasks_update" on public.tasks;
create policy "tasks_update" on public.tasks
  for update using (
    public.on_department_team(department_id)
    and (
      created_by = auth.uid()
      or assignee_id = auth.uid()
      or public.is_department_lead(department_id)
      or public.has_permission('access', 'update')
    )
  )
  with check (
    public.on_department_team(department_id)
    and (
      created_by = auth.uid()
      or assignee_id = auth.uid()
      or public.is_department_lead(department_id)
      or public.has_permission('access', 'update')
    )
  );

-- Delete a task: its creator, or a department lead / admin.
drop policy if exists "tasks_delete" on public.tasks;
create policy "tasks_delete" on public.tasks
  for delete using (
    created_by = auth.uid()
    or public.is_department_lead(department_id)
    or public.has_permission('access', 'update')
  );

-- Invites: the invited person sees their own row; managers see/manage all on
-- tasks they run.
drop policy if exists "task_invites_select" on public.task_invites;
create policy "task_invites_select" on public.task_invites
  for select using (
    user_id = auth.uid()
    or exists (
      select 1 from public.tasks t
      where t.id = task_id
        and (
          t.created_by = auth.uid()
          or public.is_department_lead(t.department_id)
          or public.has_permission('access', 'read')
        )
    )
  );

drop policy if exists "task_invites_write" on public.task_invites;
create policy "task_invites_write" on public.task_invites
  for all using (
    exists (
      select 1 from public.tasks t
      where t.id = task_id
        and (
          t.created_by = auth.uid()
          or t.assignee_id = auth.uid()
          or public.is_department_lead(t.department_id)
          or public.has_permission('access', 'update')
        )
    )
  )
  with check (
    exists (
      select 1 from public.tasks t
      where t.id = task_id
        and (
          t.created_by = auth.uid()
          or t.assignee_id = auth.uid()
          or public.is_department_lead(t.department_id)
          or public.has_permission('access', 'update')
        )
    )
  );

-- 4. Enriched list RPC --------------------------------------------------------
-- Tasks for a department the caller may see, with assignee / project / sub-team
-- names filled in. Replicates the SELECT visibility rule (SECURITY DEFINER, so
-- it can read profile names the caller couldn't otherwise).
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
  due_date      date,
  created_by    uuid,
  created_at    timestamptz,
  done_at       timestamptz
)
language sql stable security definer set search_path = public
as $$
  select t.id, t.subteam_id, s.label, t.project_id, pr.name,
         t.title, t.description, t.status,
         t.assignee_id, coalesce(ap.full_name, ap.email),
         t.start_date, t.due_date, t.created_by, t.created_at, t.done_at
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
      or exists (
        select 1 from public.task_invites ti
        where ti.task_id = t.id and ti.user_id = auth.uid()
      )
    )
  order by
    case t.status when 'todo' then 0 when 'in_progress' then 1 else 2 end,
    t.due_date nulls last,
    t.created_at;
$$;
