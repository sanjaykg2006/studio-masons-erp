-- Studio-Masons ERP — attach documents to RFI messages
-- Run AFTER 0030_task_times_and_docs.sql.
--
-- WHAT THIS ADDS
--   Files people attach to a single RFI message (a reply or an answer). Same
--   pattern as task/design attachments: the bytes live in a PRIVATE Storage
--   bucket touched only by the service role inside gated server actions; this
--   metadata row (RLS-guarded) is the security boundary.
--
--   WHO MAY ATTACH: anyone who can see the project the RFI belongs to (the same
--   people who can see the question). WHO MAY DELETE: the uploader, the target
--   department's lead, or an admin.

-- 1. The attachments table ----------------------------------------------------
create table if not exists public.rfi_attachments (
  id           uuid primary key default gen_random_uuid(),
  message_id   uuid not null references public.rfi_messages (id) on delete cascade,
  name         text not null,
  storage_path text not null,
  mime_type    text,
  size_bytes   bigint,
  uploaded_by  uuid references public.profiles (id) default auth.uid(),
  created_at   timestamptz not null default now()
);
create index if not exists rfi_attachments_message_idx on public.rfi_attachments (message_id);

-- 2. "Can the caller see the project this message belongs to?" ----------------
-- SECURITY DEFINER so it can walk message -> rfi -> project without the caller
-- needing direct read on the intermediate rows.
create or replace function public.can_see_rfi_message(p_message uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.rfi_messages m
    join public.rfis r on r.id = m.rfi_id
    where m.id = p_message and public.can_view_project(r.project_id)
  );
$$;

-- 3. RLS ----------------------------------------------------------------------
alter table public.rfi_attachments enable row level security;

-- See a message's files if you can see the question's project.
drop policy if exists "rfi_attachments_select" on public.rfi_attachments;
create policy "rfi_attachments_select" on public.rfi_attachments
  for select using (public.can_see_rfi_message(message_id));

-- Attach a file if you can see the question's project.
drop policy if exists "rfi_attachments_insert" on public.rfi_attachments;
create policy "rfi_attachments_insert" on public.rfi_attachments
  for insert with check (public.can_see_rfi_message(message_id));

-- Remove a file: the uploader, the target department's lead, or an admin.
drop policy if exists "rfi_attachments_delete" on public.rfi_attachments;
create policy "rfi_attachments_delete" on public.rfi_attachments
  for delete using (
    uploaded_by = auth.uid()
    or public.has_permission('access', 'update')
    or exists (
      select 1
      from public.rfi_messages m
      join public.rfis r on r.id = m.rfi_id
      where m.id = message_id and public.is_department_lead(r.to_department_id)
    )
  );

-- 4. Private Storage bucket for the bytes (accessed via service role) ----------
insert into storage.buckets (id, name, public)
values ('rfi-docs', 'rfi-docs', false)
on conflict (id) do nothing;

-- 5. post_rfi_message now returns the new message's id ------------------------
-- Attachments hang off a specific message, so the caller needs its id back to
-- attach files to it. Same behaviour as before, only the return type changes
-- (DROP first: CREATE OR REPLACE can't change a function's return type).
drop function if exists public.post_rfi_message(uuid, text, boolean);
create or replace function public.post_rfi_message(
  p_rfi     uuid,
  p_body    text,
  p_is_answer boolean
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_project uuid; v_to uuid; v_id uuid;
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
  values (p_rfi, trim(p_body), coalesce(p_is_answer, false))
  returning id into v_id;
  return v_id;
end;
$$;

-- 6. List the files on one RFI's whole thread ---------------------------------
-- Returned with the owning message id so the UI can group files under each
-- message. SECURITY DEFINER so uploader names resolve.
create or replace function public.list_rfi_attachments(p_rfi uuid)
returns table (
  id               uuid,
  message_id       uuid,
  name             text,
  mime_type        text,
  size_bytes       bigint,
  uploaded_by      uuid,
  uploaded_by_name text,
  created_at       timestamptz
)
language sql stable security definer set search_path = public
as $$
  select a.id, a.message_id, a.name, a.mime_type, a.size_bytes,
         a.uploaded_by, coalesce(p.full_name, p.email), a.created_at
  from public.rfi_attachments a
  join public.rfi_messages m on m.id = a.message_id
  join public.rfis r on r.id = m.rfi_id
  left join public.profiles p on p.id = a.uploaded_by
  where m.rfi_id = p_rfi and public.can_view_project(r.project_id)
  order by a.created_at;
$$;

-- 7. list_project_rfis gains "can_escalate" + the current role's rank ---------
-- can_escalate is false once a question is at the top of the ladder, so the UI
-- can grey out the Escalate button instead of surfacing an error. rank lets it
-- say how far up the ladder the question is. (DROP first: widening the table.)
drop function if exists public.list_project_rfis(uuid);
create or replace function public.list_project_rfis(p_project uuid)
returns table (
  id uuid,
  from_department_id uuid, from_label text,
  to_department_id uuid, to_label text,
  subject text, status public.rfi_status,
  current_role_id uuid, current_role_label text, current_role_rank int,
  can_escalate boolean,
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
         r.current_role_id, cr.label, cr.rank,
         -- room to climb: no current role yet, or a more-senior rung exists
         (r.current_role_id is null
            or exists (
              select 1 from public.roles up
              where up.department_id = r.to_department_id and up.rank < cr.rank
            )),
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
