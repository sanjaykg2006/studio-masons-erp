-- Studio-Masons ERP — approvals that can't get stuck silently.
-- Run AFTER 0103_receipt_grn_files.sql.
--
-- WHY
--   An item snapshots its stages when it is raised (approval_start), so changing
--   who approves a stage only ever reached NEW items: anything already waiting
--   kept the old approver and, when that role had nobody in it, stayed stuck
--   until an administrator overrode it. And nothing showed what was waiting on
--   whom — a change order sat 44 days with nobody able to approve it.
--
-- WHAT THIS CHANGES
--   1. Snapshot entries carry their stage's id. Existing waiting items are
--      matched to their stage by label (unique within a flow today).
--   2. Editing a stage's approver, role, name or "not their own" rule now also
--      updates items WAITING at — or not yet reached — that stage. Stages an
--      item already passed are history and stay as decided. Adding, removing
--      or reordering stages still affects new items only.
--   3. approval_role_holders(): how many active people can give each stage, so
--      Approval flows can warn when a stage points at a role nobody holds.
--   4. list_waiting_approvals(): every item waiting on a decision, who can give
--      it right now, and for how long it has waited.
--   5. Approvers, as chosen by the owner (2026-10-26):
--        Purchase order "Finance review"  → Finance's Accounts Head
--        Early release of retention       → Co-Founder (job title)

-- ── 1. Snapshot entries name their stage ─────────────────────────────────────
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
           'stage_id', s.id,
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

-- Back-fill waiting items. A label shared by two stages of one flow can't be
-- told apart, so such an entry is left unlinked (it simply won't follow edits).
update public.approval_requests a
   set stages = (
         select jsonb_agg(
                  case
                    when e ? 'stage_id' then e
                    else e || jsonb_build_object('stage_id', (
                      select case when count(*) = 1 then min(s.id::text)::uuid end
                      from public.approval_stages s
                      where s.flow_id = a.flow_id and s.label = e ->> 'label'
                    ))
                  end
                  order by t.ord)
         from jsonb_array_elements(a.stages) with ordinality t(e, ord)
       )
 where a.status = 'pending'
   and jsonb_array_length(a.stages) > 0;

-- ── 2. Waiting items follow stage edits ──────────────────────────────────────
create or replace function public.approval_stage_follow()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- Only entries at or after the item's current stage: earlier ones were
  -- already decided under the old rule.
  update public.approval_requests a
     set stages = (
           select jsonb_agg(
                    case
                      when e ->> 'stage_id' = new.id::text and t.ord - 1 >= a.current
                        then e || jsonb_build_object(
                               'label', new.label,
                               'approver', new.approver,
                               'role_id', new.role_id,
                               'block_own', new.block_own)
                      else e
                    end
                    order by t.ord)
           from jsonb_array_elements(a.stages) with ordinality t(e, ord)
         )
   where a.status = 'pending'
     and a.flow_id = new.flow_id
     and exists (
       select 1 from jsonb_array_elements(a.stages) with ordinality t(e, ord)
       where e ->> 'stage_id' = new.id::text and t.ord - 1 >= a.current
     );
  return new;
end;
$$;

revoke execute on function public.approval_stage_follow() from public, anon, authenticated;

drop trigger if exists approval_stages_follow on public.approval_stages;
create trigger approval_stages_follow
  after update of label, approver, role_id, block_own on public.approval_stages
  for each row
  when (old.label     is distinct from new.label
     or old.approver  is distinct from new.approver
     or old.role_id   is distinct from new.role_id
     or old.block_own is distinct from new.block_own)
  execute function public.approval_stage_follow();

-- ── 3. Who can give a stage, in general ──────────────────────────────────────
-- The active people who could ever give `p_role`'s stage: a job title's holders,
-- or anyone holding the project role on at least one project (directly or
-- through a "sees all projects" team membership).
create or replace function public.approval_role_people(p_role uuid)
returns setof uuid
language sql stable security definer set search_path = public
as $$
  select p.id
  from public.profiles p
  where p.deactivated_at is null
    and p_role is not null
    and (
      p.role_id = p_role
      or exists (select 1 from public.project_members m where m.user_id = p.id and m.role_id = p_role)
      or exists (
        select 1 from public.team_members tm
        where tm.user_id = p.id and tm.all_projects and tm.all_projects_role_id = p_role
      )
    );
$$;

revoke execute on function public.approval_role_people(uuid) from public, anon, authenticated;

-- One row per stage: how many active people can give it. A department-lead
-- stage counts every department lead.
create or replace function public.approval_role_holders()
returns table (stage_id uuid, holders integer)
language sql stable security definer set search_path = public
as $$
  select s.id,
         case
           when s.approver = 'dept_lead' then (
             select count(distinct dl.user_id)::int
             from public.department_leads dl
             join public.profiles p on p.id = dl.user_id and p.deactivated_at is null
           )
           else (select count(*)::int from public.approval_role_people(s.role_id))
         end
  from public.approval_stages s
  where public.has_permission('access', 'read');
$$;

grant execute on function public.approval_role_holders() to authenticated;

-- ── 4. Everything waiting on a decision ──────────────────────────────────────
-- For each pending item: the stage it waits on, the people who can give that
-- stage right now (after "not your own" and "a fresh pair of eyes per stage"),
-- and the full-access administrators who could step in as an override.
create or replace function public.list_waiting_approvals()
returns table (
  id uuid, flow_id text, flow_label text, item_id uuid,
  project_id uuid, project_label text, item_ref text, amount numeric,
  requester_name text, raised_at timestamptz, waiting_since timestamptz,
  stage_label text, stage_no integer, stage_count integer, approver_label text,
  can_approve text[], admin_backup text[]
)
language sql stable security definer set search_path = public
as $$
  with w as (
    select a.*, a.stages -> a.current as s,
           nullif(a.stages -> a.current ->> 'role_id', '')::uuid as role_id,
           coalesce((a.stages -> a.current ->> 'block_own')::boolean, true) as block_own
    from public.approval_requests a
    where a.status = 'pending'
      and public.has_permission('access', 'read')
  ),
  -- People who already gave a stage of the item, or raised it when it blocks
  -- that: they can't give this one, administrators included.
  barred as (
    select w.id as request_id, d.decided_by as user_id
    from w join public.approval_decisions d on d.request_id = w.id
    union
    select w.id, w.requester from w where w.block_own and w.requester is not null
  ),
  eligible as (
    select w.id as request_id, p.id as user_id, coalesce(p.full_name, p.email) as name
    from w
    join public.profiles p on p.deactivated_at is null
    where case
      when w.s ->> 'approver' = 'dept_lead' then exists (
        select 1 from public.department_leads dl
        where dl.user_id = p.id
          and (
            dl.department_id in (select tm.department_id from public.team_members tm where tm.user_id = w.requester)
            or dl.department_id = (select pr.department_id from public.projects pr where pr.id = w.project_id)
          )
      )
      when (select r.department_id from public.roles r where r.id = w.role_id) is null then
        p.role_id = w.role_id
      else
        w.project_id is not null and (
          exists (
            select 1 from public.project_members m
            where m.project_id = w.project_id and m.user_id = p.id and m.role_id = w.role_id
          )
          or exists (
            select 1 from public.team_members tm
            where tm.user_id = p.id and tm.all_projects and tm.all_projects_role_id = w.role_id
          )
        )
    end
  ),
  admins as (
    select distinct p.id as user_id, coalesce(p.full_name, p.email) as name
    from public.profiles p
    join public.role_permissions rp on rp.role_id = p.role_id and rp.resource = '*'
    where p.deactivated_at is null
  )
  select
    w.id, w.flow_id, f.label, w.item_id,
    w.project_id, coalesce(pr.code, pr.name),
    case w.flow_id
      when 'order'   then (select o.po_number from public.procurement_orders o where o.id = w.item_id)
      when 'advance' then (select o.po_number from public.procurement_orders o where o.id = w.item_id)
      when 'vendor'  then (select v.name from public.procurement_vendors v where v.id = w.item_id)
      when 'invoice' then (select i.invoice_no from public.finance_invoices i where i.id = w.item_id)
      when 'payment' then (
        select i.invoice_no from public.finance_payment_requests pq
        join public.finance_invoices i on i.id = pq.invoice_id where pq.id = w.item_id)
      when 'retention_early' then (
        select i.invoice_no from public.finance_retention rt
        join public.finance_invoices i on i.id = rt.invoice_id where rt.id = w.item_id)
      when 'budget'  then (select 'Version ' || b.version_no from public.procurement_budgets b where b.id = w.item_id)
      when 'pettycash' then (select e.description from public.pettycash_entries e where e.id = w.item_id)
    end,
    w.amount,
    coalesce(rq.full_name, rq.email), w.created_at,
    coalesce((select max(d.decided_at) from public.approval_decisions d where d.request_id = w.id), w.created_at),
    w.s ->> 'label', w.current + 1, jsonb_array_length(w.stages),
    case
      when w.s ->> 'approver' = 'dept_lead' then 'Requester''s department lead'
      else (
        select case when ro.department_id is null then ro.label
                    else coalesce(dp.label || '''s ', '') || ro.label end
        from public.roles ro left join public.departments dp on dp.id = ro.department_id
        where ro.id = w.role_id
      )
    end,
    coalesce((
      select array_agg(e.name order by e.name) from eligible e
      where e.request_id = w.id
        and not exists (select 1 from barred b where b.request_id = w.id and b.user_id = e.user_id)
    ), '{}'),
    coalesce((
      select array_agg(ad.name order by ad.name) from admins ad
      where not exists (select 1 from barred b where b.request_id = w.id and b.user_id = ad.user_id)
    ), '{}')
  from w
  join public.approval_flows f on f.id = w.flow_id
  left join public.projects pr on pr.id = w.project_id
  left join public.profiles rq on rq.id = w.requester
  order by w.created_at;
$$;

grant execute on function public.list_waiting_approvals() to authenticated;

-- ── 5. The owner's approver choices ──────────────────────────────────────────
-- After the trigger exists, so items already waiting on these stages move too.
update public.approval_stages s
   set role_id = r.id, approver = 'role'
  from public.roles r
  join public.departments d on d.id = r.department_id
 where s.flow_id = 'order' and s.label = 'Finance review'
   and d.key = 'finance' and r.label = 'Accounts Head';

update public.approval_stages s
   set role_id = r.id, approver = 'role'
  from public.roles r
 where s.flow_id = 'retention_early'
   and r.department_id is null and r.label = 'Co-Founder';
