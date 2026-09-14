-- Studio-Masons ERP — an approval stage belongs to ONE named role.
-- Run AFTER 0091_approval_batch3.sql.
--
-- WHY
--   A stage used to say "anyone holding tick X". A tick is held by as many job
--   titles, project roles and individually-ticked people as the access matrices
--   say, so a stage was never tied to one role. From here a stage NAMES ONE ROLE
--   and only that role can give it:
--     * a job title (roles.department_id is null) — held on the person's profile
--     * a department's project role — held on THIS project, through
--       project_members or a "sees all projects" team membership. Naming Project
--       Management's Project Director therefore means that department's Project
--       Director and nobody else's.
--   The only other kind left is dept_lead (the requester's department lead),
--   which already named one position rather than a tick.
--
-- WHAT ELSE CLOSES
--   * "the requester's department lead may give it too" (0090) is gone: it was a
--     second way onto a stage that names someone else.
--   * One person can no longer give two stages of the same item — every stage
--     needs a fresh pair of eyes, administrators included.
--   * Full-access administrators stay the backup so nothing can get stuck, but
--     their decision is now stamped as an override on the decision row and in
--     the Activity Log instead of passing silently.
--
-- CONVERTING WHAT IS ALREADY THERE
--   A stage that already named a job title keeps it. A tick-based stage is bound
--   to the role holding that tick when EXACTLY ONE role holds it; where several
--   (or none) do, picking one would be a guess, so the stage is left without a
--   role and Access Control → Approval flows asks for one. Until it is chosen
--   only an administrator, as a recorded override, can give that stage.

-- ── 1. A flow knows whether its items belong to a project ────────────────────
-- A project role can only be held on a project, so a flow without one (Petty
-- Cash, the vendor directory) may only name job titles.
alter table public.approval_flows
  add column if not exists has_project boolean not null default false;

update public.approval_flows set has_project = (id not in ('pettycash', 'vendor'));

-- ── 2. A stage names a role ──────────────────────────────────────────────────
alter table public.approval_stages
  add column if not exists role_id uuid references public.roles (id) on delete set null;

alter table public.approval_stages drop constraint if exists approval_stages_approver_check;

-- The one role an old stage resolves to, or NULL when it cannot be known.
-- Dropped again further down, once the conversion has used it.
create or replace function public.approval_role_of(
  p_approver text,
  p_named    uuid,
  p_resource text,
  p_action   public.app_action
)
returns uuid
language sql stable set search_path = public
as $$
  select case
    when p_approver in ('role', 'job_title') then p_named
    when p_approver in ('tick', 'senior') then (
      -- Exactly one role holds the tick, so that is the stage's role. Wildcard
      -- ('*') rows are full-access administrators, who are the backup rather
      -- than the named approver, so they are not counted.
      select case when count(*) = 1 then min(rp.role_id::text)::uuid end
      from public.role_permissions rp
      where rp.resource = p_resource and rp.action = p_action
    )
  end;
$$;

update public.approval_stages s
   set role_id  = public.approval_role_of(s.approver, s.job_title_id, s.resource, s.action),
       approver = case when s.approver = 'dept_lead' then 'dept_lead' else 'role' end
 where s.approver <> 'role';

-- Items still in flight keep the stages they started with, so their snapshots
-- are converted the same way rather than left speaking the old language.
update public.approval_requests a
   set stages = coalesce((
         select jsonb_agg(
                  jsonb_build_object(
                    'label',    e ->> 'label',
                    'approver', case when e ->> 'approver' = 'dept_lead'
                                     then 'dept_lead' else 'role' end,
                    'role_id',  public.approval_role_of(
                                  e ->> 'approver',
                                  nullif(e ->> 'job_title_id', '')::uuid,
                                  e ->> 'resource',
                                  nullif(e ->> 'action', '')::public.app_action
                                ),
                    'block_own', coalesce((e ->> 'block_own')::boolean, true)
                  ) order by ord)
         from jsonb_array_elements(a.stages) with ordinality t(e, ord)
       ), '[]'::jsonb)
 where a.status = 'pending';

drop function public.approval_role_of(text, uuid, text, public.app_action);

-- The tick, the named job title and the extra department-lead route are all
-- replaced by role_id.
alter table public.approval_stages
  drop column if exists resource,
  drop column if exists action,
  drop column if exists job_title_id,
  drop column if exists or_dept_lead;

alter table public.approval_stages
  add constraint approval_stages_approver_check check (approver in ('role', 'dept_lead'));

-- Whether the decider satisfied the stage themselves or stepped in as an
-- administrator.
alter table public.approval_decisions
  add column if not exists is_override boolean not null default false;

-- ── 3. Holding a role ────────────────────────────────────────────────────────
-- A job title is held on the profile; a department's project role is held on a
-- project, either by being a member of that project with the role or by a "sees
-- all projects" team membership set to it. A project role is never held off a
-- project, so an item without one (a Petty Cash claim) can never satisfy it.
create or replace function public.holds_role(p_role uuid, p_project uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select case
    when p_role is null then false
    when (select r.department_id from public.roles r where r.id = p_role) is null then
      exists (select 1 from public.profiles p where p.id = auth.uid() and p.role_id = p_role)
    when p_project is null then false
    else
      exists (
        select 1 from public.project_members m
        where m.project_id = p_project and m.user_id = auth.uid() and m.role_id = p_role
      )
      or exists (
        select 1 from public.team_members tm
        where tm.user_id = auth.uid()
          and tm.all_projects
          and tm.all_projects_role_id = p_role
      )
  end;
$$;

-- Only approval_block_reason calls it, and that is SECURITY DEFINER, so it
-- needs no grant of its own.
revoke execute on function public.holds_role(uuid, uuid) from public, anon, authenticated;

-- ── 4. Who may act on the stage an item is waiting on ────────────────────────
-- Split in two so a decision can tell a real approval from an administrator
-- stepping in. approval_block_reason keeps its exact signature: RLS policies
-- depend on it (pettycash_entries_select), so it can only be replaced in place.
--
-- Some reasons are ABSOLUTE — nobody passes them, administrators included:
-- your own request, and a stage when you already gave an earlier one of the
-- same item. The rest are the stage's own rule, which the administrator backup
-- may pass, and approval_decide then records that as an override.
create or replace function public.approval_stage_block(p_request uuid)
returns table (reason text, is_absolute boolean)
language plpgsql stable security definer set search_path = public
as $$
declare
  r       public.approval_requests;
  s       jsonb;
  v_role  uuid;
  v_label text;
  v_who   text;
begin
  select * into r from public.approval_requests where id = p_request;
  if not found then return query select 'Approval not found', true; return; end if;
  if r.status <> 'pending' then
    return query select 'This is no longer waiting for approval', true; return;
  end if;
  s := r.stages -> r.current;
  if s is null then
    return query select 'Nothing is waiting for approval', true; return;
  end if;
  v_label := s ->> 'label';

  if coalesce((s ->> 'block_own')::boolean, true) and r.requester = auth.uid() then
    return query select 'You can''t approve or reject your own request', true; return;
  end if;

  -- Every stage needs a fresh pair of eyes — administrators included.
  if exists (
    select 1 from public.approval_decisions d
    where d.request_id = p_request and d.decided_by = auth.uid()
  ) then
    return query select
      'You already gave an earlier step of this approval — "' || v_label
      || '" needs a different person', true;
    return;
  end if;

  if s ->> 'approver' = 'dept_lead' then
    if exists (
      select 1 from public.department_leads dl
      where dl.user_id = auth.uid()
        and (
          dl.department_id in (
            select tm.department_id from public.team_members tm where tm.user_id = r.requester
          )
          or dl.department_id = (
            select pr.department_id from public.projects pr where pr.id = r.project_id
          )
        )
    ) then
      return query select null::text, false; return;
    end if;
    v_who := 'only the requester''s department lead can give it';
  else
    v_role := nullif(s ->> 'role_id', '')::uuid;
    if public.holds_role(v_role, r.project_id) then
      return query select null::text, false; return;
    end if;
    v_who := case
      when v_role is null then
        'it has no approving role yet — one is chosen on Access Control, Approval flows'
      else
        'only ' || coalesce((select ro.label from public.roles ro where ro.id = v_role),
                            'its approving role') || ' can give it'
    end;
  end if;

  return query select 'This is waiting for "' || v_label || '" — ' || v_who, false;
end;
$$;

revoke execute on function public.approval_stage_block(uuid) from public, anon, authenticated;

-- What the screens and policies ask: the stage's rule, plus the full-access
-- administrator backup so an approval can never be stranded.
create or replace function public.approval_block_reason(p_request uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select case
    when b.reason is null then null
    when not b.is_absolute and public.has_full_access() then null
    else b.reason
  end
  from public.approval_stage_block(p_request) b;
$$;

-- ── 5. Snapshotting and deciding ─────────────────────────────────────────────
create or replace function public.approval_start(
  p_flow      text,
  p_item      uuid,
  p_requester uuid,
  p_project   uuid,
  p_amount    numeric
)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_title  uuid;
  v_stages jsonb;
  v_status text;
  v_prior  public.approval_requests;
begin
  -- A decided request means the item was returned and is being sent again:
  -- start over with today's stages. A pending one is left alone.
  select * into v_prior from public.approval_requests
  where flow_id = p_flow and item_id = p_item;
  if found then
    if v_prior.status = 'pending' then return 'pending'; end if;
    delete from public.approval_requests where id = v_prior.id;
  end if;

  select p.role_id into v_title from public.profiles p where p.id = p_requester;

  select coalesce(jsonb_agg(jsonb_build_object(
           'label', s.label, 'approver', s.approver,
           'role_id', s.role_id, 'block_own', s.block_own
         ) order by s.position), '[]'::jsonb)
    into v_stages
  from public.approval_stages s
  where s.flow_id = p_flow
    and not (v_title is not null and v_title = any (s.skip_job_title_ids))
    and (s.min_amount is null or coalesce(p_amount, 0) >= s.min_amount);

  v_status := case when jsonb_array_length(v_stages) = 0 then 'approved' else 'pending' end;
  insert into public.approval_requests (flow_id, item_id, requester, project_id, amount, stages, status)
  values (p_flow, p_item, p_requester, p_project, p_amount, v_stages, v_status);
  return v_status;
end;
$$;

revoke execute on function public.approval_start(text, uuid, uuid, uuid, numeric)
  from public, anon, authenticated;

create or replace function public.approval_decide(p_request uuid, p_approve boolean, p_note text)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  r          public.approval_requests;
  v_reason   text;
  v_done     text;
  v_note     text := nullif(trim(coalesce(p_note, '')), '');
  v_override boolean;
  v_label    text;
  v_decision text := case when p_approve then 'approved' else 'rejected' end;
begin
  select * into r from public.approval_requests where id = p_request for update;
  if not found then raise exception 'Approval not found'; end if;
  v_reason := public.approval_block_reason(p_request);
  if v_reason is not null then raise exception '%', v_reason; end if;

  -- Did they satisfy the stage themselves, or step in as an administrator?
  v_override := (select b.reason from public.approval_stage_block(p_request) b) is not null;
  v_label := r.stages -> r.current ->> 'label';

  insert into public.approval_decisions
    (request_id, stage_index, stage_label, decided_by, decision, note, is_override)
  values (p_request, r.current, v_label, auth.uid(), v_decision, v_note, v_override);

  if v_override then
    insert into public.audit_log
      (actor_id, actor_email, actor_name, action, summary, metadata, department_id)
    select auth.uid(), p.email, p.full_name, 'approval.override',
           'Administrator override: ' || v_decision || ' "' || v_label || '"',
           jsonb_build_object('flow', r.flow_id, 'itemId', r.item_id,
                              'stage', v_label, 'decision', v_decision),
           (select pr.department_id from public.projects pr where pr.id = r.project_id)
      from public.profiles p where p.id = auth.uid();
  end if;

  if not p_approve then
    v_done := 'rejected';
  elsif r.current + 1 >= jsonb_array_length(r.stages) then
    v_done := 'approved';
  else
    update public.approval_requests set current = current + 1 where id = p_request;
    return 'pending';
  end if;

  update public.approval_requests set status = v_done where id = p_request;
  perform public.approval_finish(r.flow_id, r.item_id, v_done, v_note);
  return v_done;
end;
$$;

-- The item screens (get_approval and the per-module list RPCs) call
-- approval_block_reason with one argument, so they keep working unchanged and
-- now show the buttons only to the stage's own role — or to an administrator,
-- whose decision the override stamp above records.
