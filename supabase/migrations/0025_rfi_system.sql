-- Studio-Masons ERP — Step 5 (part 2): the RFI (Request for Information) system
-- Run AFTER 0024_role_seniority.sql.
--
-- WHAT THIS ADDS
--   On a project, one department can raise a question to another department. It
--   behaves like a ticket: raised -> answered -> (can be escalated) -> closed.
--   ESCALATION climbs the target department's seniority ladder (0024) one rank at
--   a time — an unanswered question moves to the next-more-senior role. It never
--   jumps into a different department.
--
--   Visibility follows the project: anyone who can see the project can see its
--   RFIs. Only the TARGET department may post an official answer.

-- 1. Vocabulary + tables ------------------------------------------------------
do $$ begin
  create type public.rfi_status as enum ('open', 'answered', 'closed');
exception when duplicate_object then null; end $$;

create table if not exists public.rfis (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projects (id) on delete cascade,
  from_department_id uuid references public.departments (id),
  to_department_id   uuid not null references public.departments (id),
  subject            text not null,
  status             public.rfi_status not null default 'open',
  current_role_id    uuid references public.roles (id),  -- current rung of the ladder
  escalation_level   int not null default 0,
  raised_by          uuid not null default auth.uid() references public.profiles (id),
  created_at         timestamptz not null default now(),
  answered_at        timestamptz,
  closed_at          timestamptz
);
create index if not exists rfis_project_idx on public.rfis (project_id);

create table if not exists public.rfi_messages (
  id         uuid primary key default gen_random_uuid(),
  rfi_id     uuid not null references public.rfis (id) on delete cascade,
  author_id  uuid not null default auth.uid() references public.profiles (id),
  body       text not null,
  is_answer  boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists rfi_messages_rfi_idx on public.rfi_messages (rfi_id);

-- 2. Helper — may the caller act for the target department? -------------------
create or replace function public.in_target_department(p_project uuid, p_dept uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.has_permission('access', 'read')
    or public.is_department_lead(p_dept)
    or exists (
      select 1 from public.team_members tm
      where tm.department_id = p_dept and tm.user_id = auth.uid()
    )
    or exists (
      select 1 from public.project_members m
      join public.roles r on r.id = m.role_id
      where m.project_id = p_project and m.user_id = auth.uid()
        and r.department_id = p_dept
    );
$$;

-- 3. RLS (reads; writes go through the RPCs below) ----------------------------
alter table public.rfis         enable row level security;
alter table public.rfi_messages enable row level security;

drop policy if exists "rfis_select" on public.rfis;
create policy "rfis_select" on public.rfis
  for select using (public.can_view_project(project_id));

drop policy if exists "rfi_messages_select" on public.rfi_messages;
create policy "rfi_messages_select" on public.rfi_messages
  for select using (
    exists (
      select 1 from public.rfis r
      where r.id = rfi_id and public.can_view_project(r.project_id)
    )
  );

-- 4. Departments list (for the target picker) --------------------------------
create or replace function public.list_active_departments()
returns table (id uuid, key text, label text)
language sql stable security definer set search_path = public
as $$
  select id, key, label from public.departments order by label;
$$;

-- 5. Write RPCs ---------------------------------------------------------------

-- Raise a question from the caller's department to another, on a project. The
-- question starts at the BOTTOM of the target department's ladder.
create or replace function public.raise_rfi(
  p_project uuid,
  p_to_dept uuid,
  p_subject text,
  p_body    text
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_from uuid;
  v_bottom uuid;
  v_id uuid;
begin
  if not public.can_view_project(p_project) then
    raise exception 'Not authorized on this project';
  end if;
  if coalesce(trim(p_subject), '') = '' then
    raise exception 'Enter a subject';
  end if;
  if p_to_dept is null then raise exception 'Pick a department to ask'; end if;

  -- The caller's department on this project (best effort, for the "from" label).
  select r.department_id into v_from
  from public.project_members m
  join public.roles r on r.id = m.role_id
  where m.project_id = p_project and m.user_id = auth.uid()
  limit 1;
  if v_from is null then
    select tm.department_id into v_from
    from public.team_members tm where tm.user_id = auth.uid() limit 1;
  end if;

  -- Bottom of the target ladder (most junior = highest rank number).
  select id into v_bottom
  from public.roles
  where department_id = p_to_dept
  order by rank desc limit 1;

  insert into public.rfis (project_id, from_department_id, to_department_id, subject, current_role_id)
  values (p_project, v_from, p_to_dept, trim(p_subject), v_bottom)
  returning id into v_id;

  if coalesce(trim(p_body), '') <> '' then
    insert into public.rfi_messages (rfi_id, body) values (v_id, trim(p_body));
  end if;
  return v_id;
end;
$$;

-- Post a message on an RFI. A message flagged as the ANSWER may only be posted
-- by the target department, and marks the RFI answered.
create or replace function public.post_rfi_message(
  p_rfi     uuid,
  p_body    text,
  p_is_answer boolean
)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_project uuid; v_to uuid;
begin
  select project_id, to_department_id into v_project, v_to
  from public.rfis where id = p_rfi;
  if v_project is null then raise exception 'RFI not found'; end if;
  if not public.can_view_project(v_project) then
    raise exception 'Not authorized on this project';
  end if;
  if coalesce(trim(p_body), '') = '' then raise exception 'Write a message'; end if;

  if p_is_answer then
    if not public.in_target_department(v_project, v_to) then
      raise exception 'Only the asked department can post the answer';
    end if;
    update public.rfis set status = 'answered', answered_at = now() where id = p_rfi;
  end if;

  insert into public.rfi_messages (rfi_id, body, is_answer)
  values (p_rfi, trim(p_body), coalesce(p_is_answer, false));
end;
$$;

-- Escalate: climb one rung up the target department's seniority ladder.
create or replace function public.escalate_rfi(p_rfi uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_project uuid; v_to uuid; v_current uuid; v_rank int;
  v_next uuid; v_next_rank int;
begin
  select project_id, to_department_id, current_role_id
    into v_project, v_to, v_current
  from public.rfis where id = p_rfi;
  if v_project is null then raise exception 'RFI not found'; end if;
  if not public.can_view_project(v_project) then
    raise exception 'Not authorized on this project';
  end if;

  if v_current is null then
    update public.rfis
       set escalation_level = escalation_level + 1, status = 'open'
     where id = p_rfi;
    return;
  end if;

  select rank into v_rank from public.roles where id = v_current;
  select id, rank into v_next, v_next_rank
  from public.roles
  where department_id = v_to and rank < v_rank
  order by rank desc limit 1;

  if v_next is null then
    raise exception 'This question is already with the most senior role';
  end if;

  update public.rfis
     set current_role_id = v_next,
         escalation_level = escalation_level + 1,
         status = 'open'
   where id = p_rfi;
end;
$$;

-- Close an RFI: its raiser, or the target department's lead / an admin.
create or replace function public.close_rfi(p_rfi uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_to uuid; v_by uuid;
begin
  select to_department_id, raised_by into v_to, v_by
  from public.rfis where id = p_rfi;
  if v_to is null then raise exception 'RFI not found'; end if;
  if not (v_by = auth.uid() or public.is_department_lead(v_to)
          or public.has_permission('access', 'update')) then
    raise exception 'Not authorized to close this question';
  end if;
  update public.rfis set status = 'closed', closed_at = now() where id = p_rfi;
end;
$$;

-- 6. Read RPCs ----------------------------------------------------------------
create or replace function public.list_project_rfis(p_project uuid)
returns table (
  id uuid,
  from_department_id uuid, from_label text,
  to_department_id uuid, to_label text,
  subject text, status public.rfi_status,
  current_role_id uuid, current_role_label text,
  escalation_level int,
  raised_by uuid, raiser_name text,
  message_count bigint,
  can_answer boolean, can_manage boolean,
  created_at timestamptz, answered_at timestamptz, closed_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  select r.id,
         r.from_department_id, fd.label,
         r.to_department_id, td.label,
         r.subject, r.status,
         r.current_role_id, cr.label,
         r.escalation_level,
         r.raised_by, coalesce(rp.full_name, rp.email),
         (select count(*) from public.rfi_messages m where m.rfi_id = r.id),
         public.in_target_department(r.project_id, r.to_department_id),
         (r.raised_by = auth.uid()
            or public.is_department_lead(r.to_department_id)
            or public.has_permission('access', 'update')),
         r.created_at, r.answered_at, r.closed_at
  from public.rfis r
  left join public.departments fd on fd.id = r.from_department_id
  join public.departments td on td.id = r.to_department_id
  left join public.roles cr on cr.id = r.current_role_id
  left join public.profiles rp on rp.id = r.raised_by
  where r.project_id = p_project
    and public.can_view_project(p_project)
  order by case r.status when 'open' then 0 when 'answered' then 1 else 2 end,
           r.created_at desc;
$$;

create or replace function public.get_rfi_thread(p_rfi uuid)
returns table (id uuid, author_id uuid, author_name text, body text, is_answer boolean, created_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select m.id, m.author_id, coalesce(p.full_name, p.email), m.body, m.is_answer, m.created_at
  from public.rfi_messages m
  left join public.profiles p on p.id = m.author_id
  join public.rfis r on r.id = m.rfi_id
  where m.rfi_id = p_rfi and public.can_view_project(r.project_id)
  order by m.created_at;
$$;
