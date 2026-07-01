-- Studio-Masons ERP — Step 3 (cont.): revising a frozen brief with sign-off
-- Run AFTER 0020_project_lifecycle.sql.
--
-- WHAT THIS ADDS
--   Once a project is frozen (Execution phase) the brief is read-only. This adds
--   a controlled REVISION cycle on top of that lock:
--     1. Propose a revision  -> snapshots the published answers into a draft copy
--        (the live design is untouched); the brief enters revision_state='draft'.
--     2. Edit the draft       -> saveBriefAnswer writes to draft_values, never to
--        the published `values`.
--     3. Submit for approval  -> revision_state='in_review' (draft locked).
--     4. Approve & publish     -> the draft replaces the published answers, the
--        revision counter ticks, and the brief re-locks. Approver = the project's
--        department LEAD, or anyone holding project:approve.
--        (Return-for-changes -> back to 'draft'; Discard -> throw the draft away,
--        published answers restored untouched.)
--
--   The published `values` column can only change during a publish (guarded by a
--   transaction-local flag); every other write must leave it untouched while the
--   design is frozen/approved. draft_values is free scratch space.

-- 1. Revision columns ---------------------------------------------------------
alter table public.project_briefs
  add column if not exists revision_state    text
    check (revision_state in ('draft', 'in_review')),
  add column if not exists revision_no       int not null default 0,
  add column if not exists revision_by       uuid references auth.users (id),
  add column if not exists revision_opened_at timestamptz;

alter table public.project_brief_answers
  add column if not exists draft_values jsonb;

-- 2. Design lock, refined -----------------------------------------------------
-- Protect the PUBLISHED answers (`values`) while the brief is approved / frozen.
-- draft_values changes are always allowed (that's the revision scratch copy);
-- the published answers only move during a publish, flagged via a tx-local GUC.
create or replace function public.guard_brief_answer_lock()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_status public.design_brief_status;
  v_phase  public.project_phase;
begin
  if auth.uid() is null then
    return coalesce(new, old);          -- system / service-role writes
  end if;
  if coalesce(current_setting('app.publish_revision', true), '') = 'on' then
    return coalesce(new, old);          -- controlled publish (see RPC below)
  end if;

  select b.status, pr.phase
    into v_status, v_phase
  from public.project_briefs b
  join public.projects pr on pr.id = b.project_id
  where b.id = coalesce(new.brief_id, old.brief_id);

  -- Only guard the published `values`. INSERT/UPDATE that leaves it untouched
  -- (draft edits) is fine; DELETE is left alone so cascade deletes still work.
  if v_status = 'approved' or v_phase = 'execution' then
    if tg_op = 'UPDATE' and new.values is distinct from old.values then
      raise exception 'The design is frozen — propose a revision; edits are saved to the draft';
    elsif tg_op = 'INSERT' and new.values <> '{}'::jsonb then
      raise exception 'The design is frozen — propose a revision; edits are saved to the draft';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

-- 3. Who may approve a revision ----------------------------------------------
-- The project's owning-department LEAD, or any holder of project:approve.
create or replace function public.can_approve_brief_revision(p_project uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    public.has_project_permission(p_project, 'project', 'approve')
    or public.is_department_lead(
         (select department_id from public.projects where id = p_project)
       );
$$;

-- 4. The revision cycle RPCs --------------------------------------------------

-- Open a revision on a frozen brief: snapshot published -> draft, enter 'draft'.
create or replace function public.propose_brief_revision(p_brief uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_project uuid;
  v_phase   public.project_phase;
  v_state   text;
begin
  select b.project_id, pr.phase, b.revision_state
    into v_project, v_phase, v_state
  from public.project_briefs b
  join public.projects pr on pr.id = b.project_id
  where b.id = p_brief;
  if v_project is null then raise exception 'Brief not found'; end if;

  if not public.has_project_permission(v_project, 'project.brief', 'update') then
    raise exception 'Not authorized to revise this brief';
  end if;
  if v_phase <> 'execution' then
    raise exception 'This design is not frozen — edit the brief directly';
  end if;
  if v_state is not null then
    raise exception 'A revision is already in progress';
  end if;

  update public.project_briefs
     set revision_state = 'draft',
         revision_by = auth.uid(),
         revision_opened_at = now()
   where id = p_brief;

  -- Seed the draft from the published answers (values is left untouched).
  update public.project_brief_answers
     set draft_values = values
   where brief_id = p_brief;
end;
$$;

-- Submit the draft for the department lead's approval.
create or replace function public.submit_brief_revision(p_brief uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_project uuid; v_state text;
begin
  select project_id, revision_state into v_project, v_state
  from public.project_briefs where id = p_brief;
  if v_project is null then raise exception 'Brief not found'; end if;
  if not public.has_project_permission(v_project, 'project.brief', 'update') then
    raise exception 'Not authorized to submit this revision';
  end if;
  if v_state <> 'draft' then
    raise exception 'No draft revision to submit';
  end if;
  update public.project_briefs set revision_state = 'in_review' where id = p_brief;
end;
$$;

-- Approver sends a submitted revision back to the reviser for changes.
create or replace function public.return_brief_revision(p_brief uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_project uuid; v_state text;
begin
  select project_id, revision_state into v_project, v_state
  from public.project_briefs where id = p_brief;
  if v_project is null then raise exception 'Brief not found'; end if;
  if not public.can_approve_brief_revision(v_project) then
    raise exception 'Not authorized to decide this revision';
  end if;
  if v_state <> 'in_review' then
    raise exception 'No revision awaiting a decision';
  end if;
  update public.project_briefs set revision_state = 'draft' where id = p_brief;
end;
$$;

-- Approve & publish: the draft replaces the published answers, counter ticks.
create or replace function public.approve_brief_revision(p_brief uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_project uuid; v_state text;
begin
  select project_id, revision_state into v_project, v_state
  from public.project_briefs where id = p_brief;
  if v_project is null then raise exception 'Brief not found'; end if;
  if not public.can_approve_brief_revision(v_project) then
    raise exception 'Not authorized to approve this revision';
  end if;
  if v_state <> 'in_review' then
    raise exception 'No revision awaiting approval';
  end if;

  -- Controlled publish: allow the guarded `values` column to move.
  perform set_config('app.publish_revision', 'on', true);
  update public.project_brief_answers
     set values = coalesce(draft_values, values),
         draft_values = null,
         updated_at = now()
   where brief_id = p_brief;
  perform set_config('app.publish_revision', 'off', true);

  update public.project_briefs
     set revision_state = null,
         revision_no = revision_no + 1,
         revision_by = null,
         revision_opened_at = null,
         approved_by = auth.uid(),
         approved_at = now()
   where id = p_brief;
end;
$$;

-- Throw the draft away; the published answers are restored (never changed).
create or replace function public.discard_brief_revision(p_brief uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_project uuid; v_state text; v_by uuid;
begin
  select project_id, revision_state, revision_by
    into v_project, v_state, v_by
  from public.project_briefs where id = p_brief;
  if v_project is null then raise exception 'Brief not found'; end if;
  if v_state is null then raise exception 'No revision in progress'; end if;
  if not (public.can_approve_brief_revision(v_project) or v_by = auth.uid()
          or public.has_project_permission(v_project, 'project.brief', 'update')) then
    raise exception 'Not authorized to discard this revision';
  end if;

  update public.project_brief_answers set draft_values = null where brief_id = p_brief;
  update public.project_briefs
     set revision_state = null, revision_by = null, revision_opened_at = null
   where id = p_brief;
end;
$$;
