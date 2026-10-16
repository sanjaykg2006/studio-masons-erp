-- 0095 — Placeholder approvers for the five stages 0092 could not bind, and
-- a way for screens to say why the viewer can't decide a stage.
--
-- Nobody held the old tick for these stages, so 0092 left role_id empty and
-- only a full-access admin could decide them. With one admin, a two-stage item
-- then stalls for good: the admin gives stage 1 and is barred from stage 2
-- ("every stage needs a fresh pair of eyes"). These are stop-gap picks, meant
-- to be reviewed on Access Control → Approval flows. Only stages still empty
-- are touched, so anything already chosen there is kept.
--
-- Job titles throughout: Petty Cash and Vendor items carry no project (holds_role
-- never matches a department role off a project), and a job title is held on
-- every project, so no project membership is needed. Each item's stages go to
-- two different titles, so two different people can complete it.
--
--   order / Finance review ...... Co-Founder
--   order / Director approval ... Director
--   pettycash / Billing check ... Co-Founder
--   pettycash / Senior approval . Director
--   vendor / Approve ............ Director

-- ── 1. Bind the empty stages ─────────────────────────────────────────────────
update public.approval_stages s
   set approver = 'role',
       role_id  = r.id
  from (values
    ('order',     'Finance review',    'co_founder'),
    ('order',     'Director approval', 'director'),
    ('pettycash', 'Billing check',     'co_founder'),
    ('pettycash', 'Senior approval',   'director'),
    ('vendor',    'Approve',           'director')
  ) as pick(flow_id, label, role_key)
  join public.roles r on r.key = pick.role_key
 where s.flow_id = pick.flow_id
   and s.label   = pick.label
   and s.role_id is null;

-- ── 2. Carry the picks into requests already waiting ─────────────────────────
-- approval_start snapshots a flow's stages, so items raised before step 1 still
-- carry an empty role and would stay stuck. Fill only the empty ones, matched
-- by flow and stage label.
update public.approval_requests a
   set stages = (
     select jsonb_agg(
              case
                when nullif(e ->> 'role_id', '') is null and e ->> 'approver' = 'role' then
                  e || jsonb_build_object('role_id', (
                    select s.role_id from public.approval_stages s
                    where s.flow_id = a.flow_id and s.label = e ->> 'label'
                    order by s.position limit 1
                  ))
                else e
              end
              order by i)
     from jsonb_array_elements(a.stages) with ordinality as x(e, i)
   )
 where a.status = 'pending'
   and exists (
     select 1 from jsonb_array_elements(a.stages) e
     where nullif(e ->> 'role_id', '') is null and e ->> 'approver' = 'role'
   );

-- ── 3. Why can't I decide this? ──────────────────────────────────────────────
-- The screens only get a yes/no (can_decide), so a hidden button looked broken.
-- This hands back the reason for the caller, or null when they may decide.
create or replace function public.approval_wait_reason(p_request uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select public.approval_block_reason(p_request);
$$;

grant execute on function public.approval_wait_reason(uuid) to authenticated;
