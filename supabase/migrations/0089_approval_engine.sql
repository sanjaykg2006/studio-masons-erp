-- Studio-Masons ERP — editable approval stages (batch 1: Petty Cash + Change orders).
-- Run AFTER 0088_pettycash_pending_approval.sql.
--
-- THE SHAPE
--   Every flow has fixed WORK steps (log a claim, pay it; raise a change order)
--   and, between them, APPROVAL STAGES that are now data, edited on Access
--   Control → Approval flows. Each stage says:
--     approver    tick       — anyone holding resource:action
--                 senior     — holds the tick AND a job title above the requester
--                 dept_lead  — a lead of the requester's department (or, for a
--                              project item, of the project's department)
--                 job_title  — anyone whose job title is job_title_id
--     skip_job_title_ids — requesters with these job titles skip the stage
--     min_amount         — the stage applies only from this amount up
--     block_own          — the requester can't approve their own item
--   Full-access administrators can act on any stage, as a backup — never on
--   their own item.
--
--   When an item is raised its applicable stages are SNAPSHOTTED into an
--   approval_request, so editing a flow changes new items only and never
--   strands one halfway. approval_decide() moves it on; approval_finish() applies
--   the outcome to the item (claim → Awaiting Accounts; change order → Approved).
--
-- THIS BATCH
--   Petty Cash: the Billing check and Senior approval become two stages. The
--   Managing Director / Co-Founder skip moves from the roles.skips_senior_approval
--   switch into the Senior approval stage's skip list (the switch is dropped).
--   Log and Pay stay fixed work steps.
--   Change orders: "Approve" becomes one stage (the requester was never blocked
--   from deciding their own, so that stays off). The one open change order gets
--   an approval request from the default stages.

-- ── 1. Tables ────────────────────────────────────────────────────────────────
create table if not exists public.approval_flows (
  id         text primary key,
  label      text not null,
  has_amount boolean not null default false
);

create table if not exists public.approval_stages (
  id                 uuid primary key default gen_random_uuid(),
  flow_id            text not null references public.approval_flows (id) on delete cascade,
  position           integer not null,
  label              text not null,
  approver           text not null check (approver in ('tick', 'senior', 'dept_lead', 'job_title')),
  resource           text,
  action             public.app_action,
  job_title_id       uuid references public.roles (id) on delete set null,
  skip_job_title_ids uuid[] not null default '{}',
  min_amount         numeric check (min_amount is null or min_amount >= 0),
  block_own          boolean not null default true,
  created_at         timestamptz not null default now(),
  check (approver not in ('tick', 'senior') or (resource is not null and action is not null))
);
create index if not exists approval_stages_flow_idx on public.approval_stages (flow_id, position);

create table if not exists public.approval_requests (
  id         uuid primary key default gen_random_uuid(),
  flow_id    text not null references public.approval_flows (id),
  item_id    uuid not null,
  requester  uuid references public.profiles (id),
  project_id uuid references public.projects (id) on delete cascade,
  amount     numeric,
  stages     jsonb not null default '[]'::jsonb,
  current    integer not null default 0,
  status     text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  unique (flow_id, item_id)
);

create table if not exists public.approval_decisions (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.approval_requests (id) on delete cascade,
  stage_index integer not null,
  stage_label text not null,
  decided_by  uuid references public.profiles (id),
  decision    text not null check (decision in ('approved', 'rejected')),
  note        text,
  decided_at  timestamptz not null default now()
);

alter table public.approval_flows     enable row level security;
alter table public.approval_stages    enable row level security;
alter table public.approval_requests  enable row level security;
alter table public.approval_decisions enable row level security;

drop policy if exists "approval_flows_select" on public.approval_flows;
create policy "approval_flows_select" on public.approval_flows
  for select using (auth.uid() is not null);

drop policy if exists "approval_stages_select" on public.approval_stages;
create policy "approval_stages_select" on public.approval_stages
  for select using (has_permission('access', 'read'));

drop policy if exists "approval_stages_write" on public.approval_stages;
create policy "approval_stages_write" on public.approval_stages
  for all using (has_permission('access', 'update'))
  with check (has_permission('access', 'update'));

-- Requests and decisions are written only by the functions below; admins may
-- read them. Item screens read them through their own SECURITY DEFINER lists.
drop policy if exists "approval_requests_select" on public.approval_requests;
create policy "approval_requests_select" on public.approval_requests
  for select using (has_permission('access', 'read'));

drop policy if exists "approval_decisions_select" on public.approval_decisions;
create policy "approval_decisions_select" on public.approval_decisions
  for select using (has_permission('access', 'read'));

-- ── 2. The engine ────────────────────────────────────────────────────────────
-- May the caller act on this request's current stage? NULL = yes, else why not.
create or replace function public.approval_block_reason(p_request uuid)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare
  r      public.approval_requests;
  s      jsonb;
  v_kind text;
  v_ok   boolean;
begin
  select * into r from public.approval_requests where id = p_request;
  if not found then return 'Approval not found'; end if;
  if r.status <> 'pending' then return 'This is no longer waiting for approval'; end if;
  s := r.stages -> r.current;
  if s is null then return 'Nothing is waiting for approval'; end if;

  if coalesce((s ->> 'block_own')::boolean, true) and r.requester = auth.uid() then
    return 'You can''t approve or reject your own request';
  end if;
  -- Full-access administrators: the backup on every stage.
  if public.has_full_access() then return null; end if;

  v_kind := s ->> 'approver';
  if v_kind in ('tick', 'senior') then
    v_ok := case
      when r.project_id is not null then
        public.has_project_permission(r.project_id, s ->> 'resource', (s ->> 'action')::public.app_action)
      else public.has_permission(s ->> 'resource', (s ->> 'action')::public.app_action)
    end;
    if not v_ok then
      return 'This is waiting for “' || (s ->> 'label') || '”, which you can''t give';
    end if;
    if v_kind = 'senior'
       and public.job_title_rank(auth.uid()) >= public.job_title_rank(r.requester) then
      return 'This needs approval from someone senior to '
             || coalesce((
                  select ro.label from public.profiles p
                  join public.roles ro on ro.id = p.role_id
                  where p.id = r.requester and ro.department_id is null
                ), 'the requester');
    end if;
  elsif v_kind = 'dept_lead' then
    if not exists (
      select 1 from public.department_leads dl
      where dl.user_id = auth.uid()
        and (
          dl.department_id in (
            select tm.department_id from public.team_members tm where tm.user_id = r.requester
          )
          or dl.department_id = (select pr.department_id from public.projects pr where pr.id = r.project_id)
        )
    ) then
      return 'This is waiting for “' || (s ->> 'label') || '” — only the requester''s department lead can give it';
    end if;
  elsif v_kind = 'job_title' then
    if not exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role_id = (s ->> 'job_title_id')::uuid
    ) then
      return 'This is waiting for “' || (s ->> 'label') || '” — only '
             || coalesce((select label from public.roles where id = (s ->> 'job_title_id')::uuid), 'a specific job title')
             || ' can give it';
    end if;
  end if;
  return null;
end;
$$;

-- Snapshot the stages that apply to a new item. Returns 'approved' when none do.
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
begin
  select p.role_id into v_title from public.profiles p where p.id = p_requester;

  select coalesce(jsonb_agg(jsonb_build_object(
           'label', s.label, 'approver', s.approver,
           'resource', s.resource, 'action', s.action,
           'job_title_id', s.job_title_id, 'block_own', s.block_own
         ) order by s.position), '[]'::jsonb)
    into v_stages
  from public.approval_stages s
  where s.flow_id = p_flow
    and not (v_title is not null and v_title = any (s.skip_job_title_ids))
    and (s.min_amount is null or coalesce(p_amount, 0) >= s.min_amount);

  v_status := case when jsonb_array_length(v_stages) = 0 then 'approved' else 'pending' end;
  insert into public.approval_requests (flow_id, item_id, requester, project_id, amount, stages, status)
  values (p_flow, p_item, p_requester, p_project, p_amount, v_stages, v_status)
  on conflict (flow_id, item_id) do nothing;
  return v_status;
end;
$$;

-- Apply a finished request's outcome to its item.
create or replace function public.approval_finish(
  p_flow    text,
  p_item    uuid,
  p_outcome text,
  p_note    text
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_flow = 'pettycash' then
    if p_outcome = 'approved' then
      update public.pettycash_entries set status = 'pending_accounts'
      where id = p_item and status = 'pending_approval';
    else
      update public.pettycash_entries
         set status = 'rejected', rejected_by = auth.uid(), rejected_at = now(),
             reject_reason = p_note
       where id = p_item and status = 'pending_approval';
    end if;
  elsif p_flow = 'change_order' then
    update public.project_change_requests
       set status = p_outcome, decided_by = auth.uid(), decided_at = now(),
           decision_note = p_note
     where id = p_item and status = 'open';
  end if;
end;
$$;

-- Approve or reject the current stage. Returns the request's status after it.
create or replace function public.approval_decide(p_request uuid, p_approve boolean, p_note text)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  r        public.approval_requests;
  v_reason text;
  v_done   text;
  v_note   text := nullif(trim(coalesce(p_note, '')), '');
begin
  select * into r from public.approval_requests where id = p_request for update;
  if not found then raise exception 'Approval not found'; end if;
  v_reason := public.approval_block_reason(p_request);
  if v_reason is not null then raise exception '%', v_reason; end if;

  insert into public.approval_decisions (request_id, stage_index, stage_label, decided_by, decision, note)
  values (p_request, r.current, r.stages -> r.current ->> 'label', auth.uid(),
          case when p_approve then 'approved' else 'rejected' end, v_note);

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

-- Reorder a stage within its flow (Access Control → Approval flows).
create or replace function public.move_approval_stage(p_stage uuid, p_up boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_flow text; v_pos int; v_other uuid; v_other_pos int;
begin
  if not public.has_permission('access', 'update') then
    raise exception 'Not authorized to change approval flows';
  end if;
  select flow_id, position into v_flow, v_pos from public.approval_stages where id = p_stage;
  if v_flow is null then raise exception 'Stage not found'; end if;
  if p_up then
    select id, position into v_other, v_other_pos from public.approval_stages
    where flow_id = v_flow and position < v_pos order by position desc limit 1;
  else
    select id, position into v_other, v_other_pos from public.approval_stages
    where flow_id = v_flow and position > v_pos order by position asc limit 1;
  end if;
  if v_other is null then return; end if;
  update public.approval_stages set position = v_other_pos where id = p_stage;
  update public.approval_stages set position = v_pos where id = v_other;
end;
$$;

-- Only the item flows below may start or finish a request.
revoke execute on function public.approval_start(text, uuid, uuid, uuid, numeric) from public, anon, authenticated;
revoke execute on function public.approval_finish(text, uuid, text, text) from public, anon, authenticated;

-- ── 3. The two flows and their default stages ────────────────────────────────
insert into public.approval_flows (id, label, has_amount) values
  ('pettycash', 'Petty Cash claim', true),
  ('change_order', 'Change order', false)
on conflict (id) do nothing;

insert into public.approval_stages
  (flow_id, position, label, approver, resource, action, skip_job_title_ids, block_own)
select 'pettycash', 1, 'Billing check', 'tick', 'pettycash.billing', 'approve', '{}', true
where not exists (select 1 from public.approval_stages where flow_id = 'pettycash');

insert into public.approval_stages
  (flow_id, position, label, approver, resource, action, skip_job_title_ids, block_own)
select 'pettycash', 2, 'Senior approval', 'senior', 'pettycash.senior', 'approve',
       coalesce((
         select array_agg(id) from public.roles
         where department_id is null and skips_senior_approval
       ), '{}'),
       true
where not exists (select 1 from public.approval_stages where flow_id = 'pettycash' and position = 2);

insert into public.approval_stages
  (flow_id, position, label, approver, resource, action, skip_job_title_ids, block_own)
select 'change_order', 1, 'Approve', 'tick', 'project.change', 'approve', '{}', false
where not exists (select 1 from public.approval_stages where flow_id = 'change_order');

-- ── 4. Petty Cash on the engine ──────────────────────────────────────────────
alter table public.pettycash_entries alter column status set default 'pending_approval';

create or replace function public.create_pettycash(
  p_project uuid, p_category uuid, p_kind text, p_amount numeric,
  p_description text, p_spent_on date, p_file text, p_due_date date default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_outcome text;
begin
  if auth.uid() is null then raise exception 'Sign in to log petty cash'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter an amount'; end if;
  if p_due_date is not null and p_due_date < coalesce(p_spent_on, current_date) then
    raise exception 'The pay-by date cannot be before the date of the spend';
  end if;
  insert into public.pettycash_entries
    (project_id, category_id, kind, amount, description, spent_on, file_path, due_date)
  values (p_project, p_category,
          case when lower(coalesce(p_kind, '')) = 'float' then 'float' else 'reimbursement' end::public.pettycash_kind,
          p_amount, nullif(trim(p_description), ''), coalesce(p_spent_on, current_date),
          nullif(trim(p_file), ''), p_due_date)
  returning id into v_id;

  v_outcome := public.approval_start('pettycash', v_id, auth.uid(), null, p_amount);
  update public.pettycash_entries
     set status = case when v_outcome = 'approved' then 'pending_accounts' else 'pending_approval' end::public.pettycash_status
   where id = v_id;
  return v_id;
end;
$$;

-- Claims already waiting on the old fixed steps (none today) join the engine.
do $$
declare e record; v text;
begin
  for e in
    select id, created_by, amount from public.pettycash_entries
    where status in ('pending_billing', 'pending_md')
  loop
    v := public.approval_start('pettycash', e.id, e.created_by, null, e.amount);
    update public.pettycash_entries
       set status = case when v = 'approved' then 'pending_accounts' else 'pending_approval' end::public.pettycash_status
     where id = e.id;
  end loop;
end $$;

-- Paying (and rejecting at the payment step) is the fixed work step left.
create or replace function public.pettycash_block_reason(
  p_status     public.pettycash_status,
  p_created_by uuid
)
returns text
language sql stable security definer set search_path = public
as $$
  select case
    when p_status <> 'pending_accounts' then 'This claim is not waiting for payment'
    when p_created_by = auth.uid() then 'You can''t pay or reject your own claim'
    when not public.has_permission('pettycash.pay', 'issue')
      then 'This claim is waiting for payment — only Accounts can act on it'
    else null
  end;
$$;

create or replace function public.pay_pettycash(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  e        public.pettycash_entries;
  v_reason text;
begin
  select * into e from public.pettycash_entries where id = p_id for update;
  if not found then raise exception 'Entry not found'; end if;
  v_reason := public.pettycash_block_reason(e.status, e.created_by);
  if v_reason is not null then raise exception '%', v_reason; end if;
  update public.pettycash_entries
     set status = 'paid', paid_by = auth.uid(), paid_at = now()
   where id = p_id;
end;
$$;

drop function if exists public.billing_approve_pettycash(uuid);
drop function if exists public.md_approve_pettycash(uuid);
drop function if exists public.advance_pettycash(uuid, public.pettycash_status);
drop function if exists public.pettycash_skips_senior(uuid);
alter table public.roles drop column if exists skips_senior_approval;

-- The person who logged a claim may delete it until anyone has acted on it.
create or replace function public.delete_pettycash(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_by uuid; v_status public.pettycash_status;
begin
  select created_by, status into v_by, v_status from public.pettycash_entries where id = p_id;
  if v_by is null then raise exception 'Entry not found'; end if;
  if v_by <> auth.uid() then raise exception 'Only the person who logged it can remove it'; end if;
  if v_status <> 'pending_approval' or exists (
    select 1 from public.approval_decisions d
    join public.approval_requests a on a.id = d.request_id
    where a.flow_id = 'pettycash' and a.item_id = p_id
  ) then
    raise exception 'It is already in approval and cannot be removed';
  end if;
  delete from public.approval_requests where flow_id = 'pettycash' and item_id = p_id;
  delete from public.pettycash_entries where id = p_id;
end;
$$;

-- Whoever can act on a claim's current stage may see it, so a stage given to a
-- job title or a department lead works even without "See all claims".
drop policy if exists "pettycash_entries_select" on public.pettycash_entries;
create policy "pettycash_entries_select" on public.pettycash_entries
  for select using (
    created_by = auth.uid()
    or public.pettycash_sees_all()
    or exists (
      select 1 from public.approval_requests a
      where a.flow_id = 'pettycash' and a.item_id = pettycash_entries.id
        and a.status = 'pending' and public.approval_block_reason(a.id) is null
    )
  );

drop function if exists public.list_pettycash_entries();
create function public.list_pettycash_entries()
returns table (
  id uuid, created_by uuid, created_name text, project_id uuid, project_name text,
  category_name text, kind public.pettycash_kind, amount numeric, description text,
  spent_on date, file_path text, status public.pettycash_status,
  reject_reason text, created_at timestamptz, mine boolean,
  approval_id uuid, stage_label text, can_approve boolean,
  can_pay boolean, can_reject boolean,
  due_date date, paid_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select e.id, e.created_by, coalesce(cp.full_name, cp.email), e.project_id, p.name,
         c.name, e.kind, e.amount, e.description, e.spent_on, e.file_path, e.status,
         e.reject_reason, e.created_at, e.created_by = auth.uid(),
         a.id,
         case when e.status = 'pending_approval' then a.stages -> a.current ->> 'label' end,
         e.status = 'pending_approval' and a.id is not null and x.stage_reason is null,
         e.status = 'pending_accounts' and x.pay_reason is null,
         e.status = 'pending_accounts' and x.pay_reason is null,
         e.due_date, e.paid_at
  from public.pettycash_entries e
  left join public.approval_requests a on a.flow_id = 'pettycash' and a.item_id = e.id
  cross join lateral (
    select public.pettycash_block_reason(e.status, e.created_by) as pay_reason,
           case when a.id is not null then public.approval_block_reason(a.id) end as stage_reason
  ) x
  left join public.profiles cp on cp.id = e.created_by
  left join public.projects p on p.id = e.project_id
  left join public.pettycash_categories c on c.id = e.category_id
  where e.created_by = auth.uid()
     or public.pettycash_sees_all()
     or (e.status = 'pending_approval' and a.id is not null and x.stage_reason is null)
  order by e.created_at desc;
$$;

grant execute on function public.list_pettycash_entries() to authenticated;

-- ── 5. Change orders on the engine ───────────────────────────────────────────
create or replace function public.change_request_start_approval()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if public.approval_start('change_order', new.id, new.raised_by, new.project_id, null) = 'approved' then
    update public.project_change_requests
       set status = 'approved', decided_at = now(),
           decision_note = 'No approval stages were set'
     where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists project_change_requests_approval on public.project_change_requests;
create trigger project_change_requests_approval
  after insert on public.project_change_requests
  for each row execute function public.change_request_start_approval();

select public.approval_start('change_order', c.id, c.raised_by, c.project_id, null)
from public.project_change_requests c
where c.status = 'open';

-- Decisions go through approval_decide only.
drop policy if exists "project_change_requests_update" on public.project_change_requests;

create or replace function public.list_project_change_requests(p_project uuid)
returns table (
  id uuid, project_id uuid, folder_key text, title text, reason text,
  status text, raised_at timestamptz, decided_at timestamptz, decision_note text,
  approval_id uuid, stage_label text, can_approve boolean
)
language sql stable security definer set search_path = public as $$
  select c.id, c.project_id, c.folder_key, c.title, c.reason, c.status,
         c.raised_at, c.decided_at, c.decision_note,
         a.id,
         case when c.status = 'open' then a.stages -> a.current ->> 'label' end,
         c.status = 'open' and a.id is not null and public.approval_block_reason(a.id) is null
  from public.project_change_requests c
  left join public.approval_requests a on a.flow_id = 'change_order' and a.item_id = c.id
  where c.project_id = p_project
    and public.can_view_project(p_project)
    and public.has_project_permission(p_project, 'project.change', 'read')
  order by c.raised_at desc;
$$;

grant execute on function public.list_project_change_requests(uuid) to authenticated;
