-- 0102 — Every budget version needs approval before it goes live.
--
-- "Release" used to lock a version and make it the project's budget at once —
-- v1 by whoever could create it, later versions by whoever could re-version.
-- Now Release sends the version through its own approval chain ("Budget
-- version", Access Control → Approval flows) and it becomes the current
-- budget only when the last stage approves it. While it waits it is locked;
-- turned down, it goes back to an editable draft with the reason shown.
--
-- The one stage starts with the role that approves purchase intents (Project
-- Management's Project Director) — a placeholder to review on Approval flows.
-- With no stages left, Release goes straight through as before.

-- ── 1. A draft can be waiting for approval ───────────────────────────────────
alter table public.procurement_budgets
  add column if not exists submitted_at timestamptz;

-- ── 2. The flow and its stage ────────────────────────────────────────────────
insert into public.approval_flows (id, label, has_amount, has_project)
values ('budget', 'Budget version', false, true)
on conflict (id) do nothing;

insert into public.approval_stages (flow_id, position, label, approver, role_id, block_own)
select 'budget', 1, 'Approve budget', 'role',
       (select s.role_id from public.approval_stages s
         where s.flow_id = 'intent' order by s.position limit 1),
       true
where not exists (select 1 from public.approval_stages where flow_id = 'budget');

-- ── 3. What approval / turning down does ─────────────────────────────────────
create or replace function public.apply_budget_release(p_budget uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.procurement_budgets
     set status = 'released', released_at = now(), submitted_at = null
   where id = p_budget and status = 'draft';
end;
$$;

create or replace function public.apply_budget_return(p_budget uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.procurement_budgets set submitted_at = null
   where id = p_budget and status = 'draft';
end;
$$;

revoke execute on function public.apply_budget_release(uuid) from public, anon, authenticated;
revoke execute on function public.apply_budget_return(uuid) from public, anon, authenticated;

-- ── 4. Release = send for approval ───────────────────────────────────────────
create or replace function public.release_budget(p_budget uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_project uuid; v_status public.procurement_budget_status;
  v_submitted timestamptz; v_outcome text;
begin
  select project_id, status, submitted_at into v_project, v_status, v_submitted
  from public.procurement_budgets where id = p_budget;
  if v_project is null then raise exception 'Budget not found'; end if;
  if not public.has_project_permission(v_project, 'procurement.budget', 'update') then
    raise exception 'Not authorized to release this budget';
  end if;
  if v_status <> 'draft' then raise exception 'Only a draft can be released'; end if;
  if v_submitted is not null then raise exception 'This version is already waiting for approval'; end if;

  update public.procurement_budgets set submitted_at = now() where id = p_budget;
  v_outcome := public.approval_start('budget', p_budget, auth.uid(), v_project, null);
  if v_outcome = 'approved' then perform public.apply_budget_release(p_budget); end if;
end;
$$;

-- ── 5. Waiting for approval = locked ─────────────────────────────────────────
create or replace function public.guard_budget_released_lock()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_budget uuid; v_status public.procurement_budget_status; v_submitted timestamptz;
begin
  if auth.uid() is null then return coalesce(new, old); end if;

  if tg_table_name = 'procurement_budget_packages' then
    v_budget := coalesce(new.budget_id, old.budget_id);
  else
    select pk.budget_id into v_budget
    from public.procurement_budget_packages pk
    where pk.id = coalesce(new.package_id, old.package_id);
  end if;

  select status, submitted_at into v_status, v_submitted
  from public.procurement_budgets where id = v_budget;
  if v_status = 'released' then
    raise exception 'This budget version is released and locked — make a new version to edit';
  end if;
  if v_submitted is not null then
    raise exception 'This budget version is waiting for approval — it can be edited again if it is sent back';
  end if;
  return coalesce(new, old);
end;
$$;

-- ── 6. The engine hands budget outcomes to step 3 ────────────────────────────
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
  elsif p_flow = 'invoice' then
    if p_outcome = 'approved' then perform public.apply_invoice_director_approval(p_item);
    else perform public.apply_invoice_rejection(p_item); end if;
  elsif p_flow = 'payment' then
    if p_outcome = 'approved' then perform public.apply_payment_approval(p_item);
    else perform public.apply_payment_rejection(p_item); end if;
  elsif p_flow = 'advance' then
    if p_outcome = 'approved' then perform public.apply_advance_approval(p_item);
    else perform public.apply_advance_rejection(p_item); end if;
  elsif p_flow = 'retention_early' then
    if p_outcome = 'approved' then perform public.apply_early_retention_approval(p_item);
    else perform public.apply_early_retention_rejection(p_item); end if;
  elsif p_flow = 'order' then
    if p_outcome = 'approved' then perform public.apply_order_approval(p_item); end if;
    -- A rejected PO stays a draft; it can be sent for approval again.
  elsif p_flow = 'budget' then
    if p_outcome = 'approved' then perform public.apply_budget_release(p_item);
    else perform public.apply_budget_return(p_item); end if;
  end if;
end;
$$;

revoke execute on function public.approval_finish(text, uuid, text, text) from public, anon, authenticated;
