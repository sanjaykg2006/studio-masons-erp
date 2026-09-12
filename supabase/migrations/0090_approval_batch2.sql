-- Studio-Masons ERP — editable approval stages, batch 2.
-- Run AFTER 0089_approval_engine.sql.
--
-- FLOWS MOVED ONTO THE ENGINE
--   purchase intent · vendor (directory) · brief · brief revision
--
--   Each keeps exactly what it does today. The work a decision performs — the
--   intent's PO-amendment routing, the revision's controlled publish, the
--   vendor's status stamp — moves into an apply_* helper with only its own
--   permission check removed, because the stage has already decided who may
--   act. approval_finish calls it.
--
--   Items enter their flow through triggers, so the long raise/submit
--   functions are left untouched:
--     procurement_intents  insert                    → intent
--     procurement_vendors  insert                    → vendor
--     project_briefs       status → 'in_review'      → brief
--     project_briefs       revision_state → 'in_review' → brief_revision
--
-- TWO ENGINE ADDITIONS
--   * or_dept_lead on a stage: the requester's department lead may give it too.
--     Brief revisions work this way today (project:approve OR the owning
--     department's lead), and would otherwise lose the lead's route.
--   * Re-submitting an item that was returned starts a fresh approval, instead
--     of leaving the old decided request in place.

-- ── 1. Engine additions ──────────────────────────────────────────────────────
alter table public.approval_stages
  add column if not exists or_dept_lead boolean not null default false;

create or replace function public.approval_block_reason(p_request uuid)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare
  r      public.approval_requests;
  s      jsonb;
  v_kind text;
  v_ok   boolean;
  v_lead boolean;
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

  -- "or the requester's department lead" — an extra route on any stage.
  v_lead := coalesce((s ->> 'or_dept_lead')::boolean, false) and exists (
    select 1 from public.department_leads dl
    where dl.user_id = auth.uid()
      and (
        dl.department_id in (
          select tm.department_id from public.team_members tm where tm.user_id = r.requester
        )
        or dl.department_id = (select pr.department_id from public.projects pr where pr.id = r.project_id)
      )
  );
  if v_lead then return null; end if;

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
           'resource', s.resource, 'action', s.action,
           'job_title_id', s.job_title_id, 'block_own', s.block_own,
           'or_dept_lead', s.or_dept_lead
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

revoke execute on function public.approval_start(text, uuid, uuid, uuid, numeric) from public, anon, authenticated;

-- One read for any item's approval state, used by the item screens.
create or replace function public.get_approval(p_flow text, p_item uuid)
returns table (id uuid, status text, stage_label text, can_act boolean)
language sql stable security definer set search_path = public
as $$
  select a.id, a.status,
         case when a.status = 'pending' then a.stages -> a.current ->> 'label' end,
         a.status = 'pending' and public.approval_block_reason(a.id) is null
  from public.approval_requests a
  where a.flow_id = p_flow and a.item_id = p_item;
$$;

grant execute on function public.get_approval(text, uuid) to authenticated;

-- ── 2. What a decision does, per flow (the old bodies, minus their own check) ─
create or replace function public.apply_intent_approval(p_intent uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_project uuid; v_status public.procurement_intent_status;
  il record; v_ol uuid; v_order uuid; v_ver int;
  v_touched uuid[] := '{}';
  v_o uuid;
begin
  select project_id, status into v_project, v_status
  from public.procurement_intents where id = p_intent;
  if v_project is null then raise exception 'Intent not found'; end if;
  if v_status <> 'pending' then raise exception 'Only a pending intent can be approved'; end if;

  update public.procurement_intents
     set status = 'approved', approved_by = auth.uid(), approved_at = now()
   where id = p_intent;
  update public.procurement_intent_lines
     set bypass_approved_by = auth.uid()
   where intent_id = p_intent and over_budget and bypass_approved_by is null;

  -- Auto-route each line that already has a live PO into a PO amendment.
  for il in
    select l.budget_line_id, l.qty_requested
    from public.procurement_intent_lines l
    where l.intent_id = p_intent and l.budget_line_id is not null
  loop
    v_ol := null; v_order := null;
    select ol.id, o.id into v_ol, v_order
    from public.procurement_order_lines ol
    join public.procurement_orders o on o.id = ol.order_id
    where ol.budget_line_id = il.budget_line_id
      and o.project_id = v_project
      and o.status in ('issued', 'amending', 'closed')
    order by case o.status when 'amending' then 0 when 'issued' then 1 else 2 end,
             o.created_at desc
    limit 1;
    if v_ol is null then continue; end if;  -- no PO yet: normal manual path

    if not (v_order = any (v_touched)) then
      -- Only open a fresh amendment if the PO isn't already being amended. Either
      -- way, NO sign-off is pre-filled — the amendment runs the full process.
      if (select status from public.procurement_orders where id = v_order) <> 'amending' then
        select version_no into v_ver from public.procurement_orders where id = v_order;
        insert into public.procurement_order_amendments
          (order_id, version_no, note, originating_intent_id, lines_snapshot)
        select v_order, v_ver, 'Auto-routed from an approved intent', p_intent,
               (select jsonb_agg(jsonb_build_object(
                          'description', ol.description, 'qty_ordered', ol.qty_ordered, 'rate', ol.rate))
                from public.procurement_order_lines ol where ol.order_id = v_order);
        update public.procurement_orders
           set status = 'amending', version_no = version_no + 1,
               finance_reviewed_by = null, finance_reviewed_at = null,
               director_approved_by = null, director_approved_at = null,
               senior_bypass_by = null, senior_bypass_at = null
         where id = v_order;
      end if;
      v_touched := array_append(v_touched, v_order);
    end if;

    update public.procurement_order_lines
       set qty_ordered = qty_ordered + il.qty_requested
     where id = v_ol;
  end loop;

  foreach v_o in array v_touched loop
    perform public.recompute_order_over_budget(v_o);
  end loop;
end;
$$;

create or replace function public.apply_intent_rejection(p_intent uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.procurement_intents set status = 'rejected'
  where id = p_intent and status = 'pending';
end;
$$;

create or replace function public.apply_vendor_decision(p_vendor uuid, p_approved boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.procurement_vendors
     set status      = case when p_approved then 'approved' else 'rejected' end::public.procurement_vendor_status,
         approved_by = case when p_approved then auth.uid() else null end,
         approved_at = case when p_approved then now() else null end,
         updated_at  = now()
   where id = p_vendor;
end;
$$;

create or replace function public.apply_brief_approval(p_brief uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_project uuid;
begin
  select project_id into v_project from public.project_briefs where id = p_brief;
  if v_project is null then raise exception 'Brief not found'; end if;
  update public.project_briefs
     set status = 'approved', approved_by = auth.uid(), approved_at = now()
   where id = p_brief;
  -- When every brief on the project is approved, advance the project.
  if not exists (
    select 1 from public.project_briefs
    where project_id = v_project and status <> 'approved'
  ) then
    update public.projects set status = 'brief_approved' where id = v_project;
  end if;
end;
$$;

create or replace function public.apply_brief_return(p_brief uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.project_briefs set status = 'in_progress'
  where id = p_brief and status = 'in_review';
end;
$$;

create or replace function public.apply_brief_revision_publish(p_brief uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_state text;
begin
  select revision_state into v_state from public.project_briefs where id = p_brief;
  if v_state <> 'in_review' then raise exception 'No revision awaiting approval'; end if;

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

create or replace function public.apply_brief_revision_return(p_brief uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.project_briefs set revision_state = 'draft'
  where id = p_brief and revision_state = 'in_review';
end;
$$;

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
  elsif p_flow = 'intent' then
    if p_outcome = 'approved' then perform public.apply_intent_approval(p_item);
    else perform public.apply_intent_rejection(p_item); end if;
  elsif p_flow = 'vendor' then
    perform public.apply_vendor_decision(p_item, p_outcome = 'approved');
  elsif p_flow = 'brief' then
    if p_outcome = 'approved' then perform public.apply_brief_approval(p_item);
    else perform public.apply_brief_return(p_item); end if;
  elsif p_flow = 'brief_revision' then
    if p_outcome = 'approved' then perform public.apply_brief_revision_publish(p_item);
    else perform public.apply_brief_revision_return(p_item); end if;
  end if;
end;
$$;

revoke execute on function public.approval_finish(text, uuid, text, text) from public, anon, authenticated;

-- ── 3. The flows and their default stages (today's behaviour) ────────────────
insert into public.approval_flows (id, label, has_amount) values
  ('intent', 'Purchase intent', false),
  ('vendor', 'Vendor in the directory', false),
  ('brief', 'Brief', false),
  ('brief_revision', 'Brief revision', false)
on conflict (id) do nothing;

insert into public.approval_stages
  (flow_id, position, label, approver, resource, action, block_own, or_dept_lead)
select v.flow, 1, v.label, 'tick', v.resource, v.action::public.app_action, false, v.lead
from (values
  ('intent', 'Approve', 'procurement.intent', 'approve', false),
  ('vendor', 'Approve', 'procurement.vendor', 'approve', false),
  ('brief', 'Approve', 'project.brief', 'approve', false),
  -- Today: project:approve OR the owning department's lead.
  ('brief_revision', 'Approve & publish', 'project', 'approve', true)
) as v(flow, label, resource, action, lead)
where not exists (select 1 from public.approval_stages s where s.flow_id = v.flow);

-- ── 4. Items join their flow as they are raised or submitted ────────────────
create or replace function public.start_item_approval()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_outcome text;
begin
  if tg_table_name = 'procurement_intents' then
    perform public.approval_start('intent', new.id, new.raised_by, new.project_id, null);
  elsif tg_table_name = 'procurement_vendors' then
    perform public.approval_start('vendor', new.id, auth.uid(), null, null);
  elsif tg_table_name = 'project_briefs' then
    if new.status = 'in_review' and (tg_op = 'INSERT' or old.status is distinct from 'in_review') then
      v_outcome := public.approval_start('brief', new.id, auth.uid(), new.project_id, null);
      if v_outcome = 'approved' then perform public.apply_brief_approval(new.id); end if;
    end if;
    if new.revision_state = 'in_review'
       and (tg_op = 'INSERT' or old.revision_state is distinct from 'in_review') then
      v_outcome := public.approval_start('brief_revision', new.id, auth.uid(), new.project_id, null);
      if v_outcome = 'approved' then perform public.apply_brief_revision_publish(new.id); end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists procurement_intents_approval on public.procurement_intents;
create trigger procurement_intents_approval
  after insert on public.procurement_intents
  for each row execute function public.start_item_approval();

drop trigger if exists procurement_vendors_approval on public.procurement_vendors;
create trigger procurement_vendors_approval
  after insert on public.procurement_vendors
  for each row execute function public.start_item_approval();

drop trigger if exists project_briefs_approval on public.project_briefs;
create trigger project_briefs_approval
  after insert or update on public.project_briefs
  for each row execute function public.start_item_approval();

-- Anything already waiting joins with today's stages.
select public.approval_start('intent', i.id, i.raised_by, i.project_id, null)
from public.procurement_intents i where i.status = 'pending';

select public.approval_start('vendor', v.id, null, null, null)
from public.procurement_vendors v where v.status = 'draft';

select public.approval_start('brief', b.id, null, b.project_id, null)
from public.project_briefs b where b.status = 'in_review';

select public.approval_start('brief_revision', b.id, b.revision_by, b.project_id, null)
from public.project_briefs b where b.revision_state = 'in_review';

-- ── 5. Decisions go through the stages ───────────────────────────────────────
drop function if exists public.approve_intent(uuid);
drop function if exists public.reject_intent(uuid);
drop function if exists public.approve_brief_revision(uuid);
drop function if exists public.return_brief_revision(uuid);

-- Finance may still re-status a vendor later (e.g. strike one off), but a
-- vendor waiting on its stages is decided there.
create or replace function public.set_vendor_status(p_vendor uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('procurement.vendor', 'approve') then
    raise exception 'Not authorized to approve vendors';
  end if;
  if exists (
    select 1 from public.approval_requests a
    where a.flow_id = 'vendor' and a.item_id = p_vendor and a.status = 'pending'
  ) then
    raise exception 'This vendor is waiting on its approval stages — decide it there';
  end if;
  perform public.apply_vendor_decision(p_vendor, p_status = 'approved');
  if not found then raise exception 'Vendor not found'; end if;
end;
$$;

-- ── 6. The lists carry each item's stage ─────────────────────────────────────
drop function if exists public.list_project_intents(uuid);
create function public.list_project_intents(p_project uuid)
returns table (
  id uuid, status public.procurement_intent_status, needed_by date, notes text,
  raised_by uuid, raiser_name text, created_at timestamptz,
  approved_by uuid, approver_name text, approved_at timestamptz,
  line_count bigint, total_qty numeric, over_budget_any boolean,
  can_approve boolean, can_withdraw boolean,
  approval_id uuid, stage_label text
)
language sql stable security definer set search_path = public as $$
  select i.id, i.status, i.needed_by, i.notes,
         i.raised_by, coalesce(rp.full_name, rp.email), i.created_at,
         i.approved_by, coalesce(ap.full_name, ap.email), i.approved_at,
         (select count(*) from public.procurement_intent_lines il where il.intent_id = i.id),
         (select coalesce(sum(il.qty_requested), 0) from public.procurement_intent_lines il where il.intent_id = i.id),
         exists (select 1 from public.procurement_intent_lines il where il.intent_id = i.id and il.over_budget),
         i.status = 'pending' and a.id is not null and public.approval_block_reason(a.id) is null,
         (i.raised_by = auth.uid() and i.status = 'pending'),
         a.id,
         case when i.status = 'pending' then a.stages -> a.current ->> 'label' end
  from public.procurement_intents i
  left join public.approval_requests a on a.flow_id = 'intent' and a.item_id = i.id
  left join public.profiles rp on rp.id = i.raised_by
  left join public.profiles ap on ap.id = i.approved_by
  where i.project_id = p_project
    and public.has_project_permission(p_project, 'procurement.intent', 'read')
  order by case i.status when 'pending' then 0 when 'approved' then 1 else 2 end,
           i.created_at desc;
$$;

grant execute on function public.list_project_intents(uuid) to authenticated;

drop function if exists public.list_vendors();
create function public.list_vendors()
returns table (
  id uuid, name text, type public.procurement_vendor_type, trade text,
  contact_name text, contact_phone text, contact_email text,
  address text, gst text, pan text,
  status public.procurement_vendor_status,
  approved_by uuid, approved_by_name text, approved_at timestamptz,
  created_at timestamptz,
  approval_id uuid, stage_label text, can_approve boolean
)
language sql stable security definer set search_path = public as $$
  select v.id, v.name, v.type, v.trade,
         v.contact_name, v.contact_phone, v.contact_email,
         v.address, v.gst, v.pan,
         v.status,
         v.approved_by, coalesce(p.full_name, p.email), v.approved_at,
         v.created_at,
         a.id,
         case when v.status = 'draft' then a.stages -> a.current ->> 'label' end,
         v.status = 'draft' and a.id is not null and public.approval_block_reason(a.id) is null
  from public.procurement_vendors v
  left join public.approval_requests a on a.flow_id = 'vendor' and a.item_id = v.id
  left join public.profiles p on p.id = v.approved_by
  where public.has_permission('procurement.vendor', 'read')
  order by v.name;
$$;

grant execute on function public.list_vendors() to authenticated;
