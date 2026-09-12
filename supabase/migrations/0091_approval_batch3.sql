-- Studio-Masons ERP — editable approval stages, batch 3: the money flows.
-- Run AFTER 0090_approval_batch2.sql.
--
-- FLOWS MOVED ONTO THE ENGINE
--   vendor invoice · payment request · PO advance · early retention release ·
--   purchase order (Finance review + Director approval)
--
--   As in batch 2, what a decision DOES is untouched: each old approval body
--   becomes an apply_* helper with only its own permission check removed (the
--   stage has already decided who may act), and approval_finish calls it. The
--   invoice's over-PO-cap block, the payment rejection that frees the invoice's
--   requested amount, the advance's TDS-adjusted payable and the retention
--   stamps all behave exactly as before.
--
--   Work steps stay fixed and keep their own ticks: Accounts books an invoice,
--   Accounts pays a payment / advance / retention, Procurement generates and
--   releases POs, and the senior override still clears an over-budget PO.
--
--   Items enter their flow by trigger: an invoice is entered, a payment request
--   raised, an advance requested, an early release requested, a PO created (or
--   sent back to amending, which needs fresh sign-off).
--
-- RELEASING A PO
--   release_order checked that both the Finance and Director stamps were set.
--   It now checks the PO's approval is complete — the stages decide how many
--   sign-offs there are. The two stamps are still filled in, from whoever
--   actually decided, so the PO record and document read the same as before.
--   A rejected PO can be sent for approval again (restart_order_approval).

-- ── 1. What each decision does ───────────────────────────────────────────────
create or replace function public.apply_invoice_director_approval(p_invoice uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_status public.finance_invoice_status;
begin
  select status into v_status from public.finance_invoices where id = p_invoice;
  if v_status is null then raise exception 'Invoice not found'; end if;
  if v_status <> 'pending_director' then raise exception 'This invoice is not awaiting director approval'; end if;
  if public.invoice_over_cap(p_invoice)
     and (select cap_bypass_at from public.finance_invoices where id = p_invoice) is null then
    raise exception 'This invoice is over the PO cap — a Director/MD must override it before approval';
  end if;
  update public.finance_invoices
     set status = 'pending_accounts', director_approved_by = auth.uid(), director_approved_at = now()
   where id = p_invoice;
end;
$$;

create or replace function public.apply_invoice_rejection(p_invoice uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.finance_invoices set status = 'rejected'
  where id = p_invoice and status in ('pending_director', 'pending_accounts');
end;
$$;

create or replace function public.apply_payment_approval(p_req uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_status public.finance_payment_status;
begin
  select status into v_status from public.finance_payment_requests where id = p_req;
  if v_status is null then raise exception 'Request not found'; end if;
  if v_status <> 'pending_director' then raise exception 'This request is not awaiting approval'; end if;
  update public.finance_payment_requests
     set status = 'approved', director_approved_by = auth.uid(), director_approved_at = now()
   where id = p_req;
end;
$$;

create or replace function public.apply_payment_rejection(p_req uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_inv uuid; v_amt numeric; v_status public.finance_payment_status;
begin
  select status, invoice_id, amount into v_status, v_inv, v_amt
  from public.finance_payment_requests where id = p_req;
  if v_status is null then raise exception 'Request not found'; end if;
  if v_status not in ('pending_director', 'approved') then return; end if;
  update public.finance_payment_requests set status = 'rejected' where id = p_req;
  -- Free the amount back on the invoice.
  update public.finance_invoices
     set requested_amount = greatest(0, coalesce(requested_amount, 0) - v_amt)
   where id = v_inv;
end;
$$;

create or replace function public.apply_advance_approval(p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_amt numeric; v_tds numeric;
begin
  select advance_requested, advance_tds_pct into v_amt, v_tds
  from public.procurement_orders where id = p_order;
  if coalesce(v_amt, 0) <= 0 then raise exception 'No advance has been requested'; end if;
  update public.procurement_orders
     set advance_approved_by = auth.uid(),
         advance_approved_at = now(),
         advance_payable = v_amt - v_amt * coalesce(v_tds, 0) / 100
   where id = p_order;
end;
$$;

create or replace function public.apply_advance_rejection(p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- The request is turned down: clear it so a fresh one can be made.
  update public.procurement_orders
     set advance_requested = null, advance_tds_pct = null
   where id = p_order and advance_approved_at is null;
end;
$$;

create or replace function public.apply_early_retention_approval(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_req timestamptz;
begin
  select early_requested_at into v_req from public.finance_retention where id = p_id;
  if v_req is null then raise exception 'No early release has been requested'; end if;
  update public.finance_retention
     set early_approved_by = auth.uid(), early_approved_at = now()
   where id = p_id;
end;
$$;

create or replace function public.apply_early_retention_rejection(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.finance_retention
     set early_requested_by = null, early_requested_at = null
   where id = p_id and early_approved_at is null;
end;
$$;

-- A fully approved PO keeps its two stamps, taken from who actually decided:
-- the first decision is the Finance sign-off, the last the Director's.
create or replace function public.apply_order_approval(p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_first record; v_last record;
begin
  select d.decided_by, d.decided_at into v_first
  from public.approval_decisions d
  join public.approval_requests a on a.id = d.request_id
  where a.flow_id = 'order' and a.item_id = p_order and d.decision = 'approved'
  order by d.decided_at asc limit 1;

  select d.decided_by, d.decided_at into v_last
  from public.approval_decisions d
  join public.approval_requests a on a.id = d.request_id
  where a.flow_id = 'order' and a.item_id = p_order and d.decision = 'approved'
  order by d.decided_at desc limit 1;

  update public.procurement_orders
     set finance_reviewed_by  = coalesce(v_first.decided_by, auth.uid()),
         finance_reviewed_at  = coalesce(v_first.decided_at, now()),
         director_approved_by = coalesce(v_last.decided_by, auth.uid()),
         director_approved_at = coalesce(v_last.decided_at, now())
   where id = p_order and status in ('draft', 'amending');
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
  end if;
end;
$$;

revoke execute on function public.approval_finish(text, uuid, text, text) from public, anon, authenticated;

-- ── 2. The flows and their default stages (today's rules) ────────────────────
insert into public.approval_flows (id, label, has_amount) values
  ('invoice', 'Vendor invoice', true),
  ('payment', 'Payment request', true),
  ('advance', 'PO advance', true),
  ('retention_early', 'Early release of retention', true),
  ('order', 'Purchase order', true)
on conflict (id) do nothing;

insert into public.approval_stages
  (flow_id, position, label, approver, resource, action, block_own)
select v.flow, v.pos, v.label, 'tick', v.resource, v.action::public.app_action, false
from (values
  ('invoice', 1, 'Director approval', 'finance.invoice', 'approve'),
  ('payment', 1, 'Director approval', 'finance.payment', 'approve'),
  ('advance', 1, 'Approve advance', 'finance.advance', 'approve'),
  ('retention_early', 1, 'Approve early release', 'finance.retention', 'manage'),
  ('order', 1, 'Finance review', 'procurement.order', 'review'),
  ('order', 2, 'Director approval', 'procurement.order', 'approve')
) as v(flow, pos, label, resource, action)
where not exists (select 1 from public.approval_stages s where s.flow_id = v.flow);

-- ── 3. Items enter their flow ────────────────────────────────────────────────
create or replace function public.start_money_approval()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_table_name = 'finance_invoices' then
    perform public.approval_start('invoice', new.id, auth.uid(), new.project_id, new.amount_total);
  elsif tg_table_name = 'finance_payment_requests' then
    perform public.approval_start('payment', new.id, auth.uid(), new.project_id, new.amount);
  elsif tg_table_name = 'finance_retention' then
    if new.early_requested_at is not null
       and (tg_op = 'INSERT' or old.early_requested_at is null)
       and new.early_approved_at is null then
      perform public.approval_start('retention_early', new.id, auth.uid(), new.project_id, new.amount);
    end if;
  elsif tg_table_name = 'procurement_orders' then
    if tg_op = 'UPDATE'
       and coalesce(new.advance_requested, 0) > 0
       and new.advance_approved_at is null
       and coalesce(old.advance_requested, 0) is distinct from coalesce(new.advance_requested, 0) then
      perform public.approval_start('advance', new.id, auth.uid(), new.project_id, new.advance_requested);
    end if;
    if (tg_op = 'INSERT' and new.status = 'draft')
       or (tg_op = 'UPDATE' and new.status = 'amending' and old.status is distinct from 'amending') then
      perform public.approval_start('order', new.id, auth.uid(), new.project_id,
                                    public.order_total_value(new.id));
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists finance_invoices_approval on public.finance_invoices;
create trigger finance_invoices_approval
  after insert on public.finance_invoices
  for each row execute function public.start_money_approval();

drop trigger if exists finance_payments_approval on public.finance_payment_requests;
create trigger finance_payments_approval
  after insert on public.finance_payment_requests
  for each row execute function public.start_money_approval();

drop trigger if exists finance_retention_approval on public.finance_retention;
create trigger finance_retention_approval
  after insert or update on public.finance_retention
  for each row execute function public.start_money_approval();

drop trigger if exists procurement_orders_approval on public.procurement_orders;
create trigger procurement_orders_approval
  after insert or update on public.procurement_orders
  for each row execute function public.start_money_approval();

-- Anything already waiting joins with today's stages.
select public.approval_start('invoice', i.id, null, i.project_id, i.amount_total)
from public.finance_invoices i where i.status = 'pending_director';

select public.approval_start('payment', pr.id, null, pr.project_id, pr.amount)
from public.finance_payment_requests pr where pr.status = 'pending_director';

select public.approval_start('advance', o.id, null, o.project_id, o.advance_requested)
from public.procurement_orders o
where coalesce(o.advance_requested, 0) > 0 and o.advance_approved_at is null;

select public.approval_start('retention_early', rt.id, null, rt.project_id, rt.amount)
from public.finance_retention rt
where rt.early_requested_at is not null and rt.early_approved_at is null;

select public.approval_start('order', o.id, null, o.project_id, public.order_total_value(o.id))
from public.procurement_orders o where o.status in ('draft', 'amending');

-- ── 4. Decisions go through the stages ───────────────────────────────────────
drop function if exists public.director_approve_invoice(uuid);
drop function if exists public.approve_payment_request(uuid);
drop function if exists public.reject_payment_request(uuid);
drop function if exists public.approve_po_advance(uuid);
drop function if exists public.approve_early_retention(uuid);
drop function if exists public.review_order(uuid);
drop function if exists public.approve_order(uuid);

-- Accounts may still reject an invoice at the booking step; while it is in its
-- approval stages, it is decided there.
create or replace function public.reject_invoice(p_invoice uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_project uuid;
begin
  select project_id into v_project from public.finance_invoices where id = p_invoice;
  if v_project is null then raise exception 'Invoice not found'; end if;
  if not (public.has_project_permission(v_project, 'finance.invoice', 'approve')
          or public.has_project_permission(v_project, 'finance.invoice', 'review')) then
    raise exception 'Not authorized to reject this invoice';
  end if;
  if exists (
    select 1 from public.approval_requests a
    where a.flow_id = 'invoice' and a.item_id = p_invoice and a.status = 'pending'
  ) then
    raise exception 'This invoice is waiting on its approval stages — decide it there';
  end if;
  perform public.apply_invoice_rejection(p_invoice);
end;
$$;

-- Releasing a PO now asks whether its approval is complete, not whether two
-- particular stamps are set.
create or replace function public.release_order(p_order uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_project uuid; v_status public.procurement_order_status; v_approval text;
begin
  perform public.recompute_order_over_budget(p_order);
  select project_id, status into v_project, v_status
  from public.procurement_orders where id = p_order;
  if v_project is null then raise exception 'Order not found'; end if;
  if not public.has_project_permission(v_project, 'procurement.order', 'issue') then
    raise exception 'Not authorized to release orders';
  end if;
  if v_status not in ('draft', 'amending') then raise exception 'This PO is not awaiting release'; end if;

  select a.status into v_approval from public.approval_requests a
  where a.flow_id = 'order' and a.item_id = p_order;
  if v_approval is null then
    raise exception 'This PO has no approval yet — send it for approval first';
  elsif v_approval = 'pending' then
    raise exception 'This PO is still going through its approval stages';
  elsif v_approval = 'rejected' then
    raise exception 'This PO was rejected — send it for approval again first';
  end if;

  update public.procurement_orders
     set status = 'issued', issued_by = auth.uid(), issued_at = now()
   where id = p_order;
end;
$$;

-- Send a rejected (or never-started) PO through its approval stages again.
create or replace function public.restart_order_approval(p_order uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_project uuid; v_status public.procurement_order_status;
begin
  select project_id, status into v_project, v_status
  from public.procurement_orders where id = p_order;
  if v_project is null then raise exception 'Order not found'; end if;
  if not public.has_project_permission(v_project, 'procurement.order', 'issue') then
    raise exception 'Not authorized to send this PO for approval';
  end if;
  if v_status not in ('draft', 'amending') then raise exception 'This PO is not awaiting approval'; end if;
  perform public.approval_start('order', p_order, auth.uid(), v_project,
                                public.order_total_value(p_order));
end;
$$;

grant execute on function public.restart_order_approval(uuid) to authenticated;

-- ── 5. The lists carry each item's stage ─────────────────────────────────────
drop function if exists public.list_project_invoices(uuid);
create function public.list_project_invoices(p_project uuid)
returns table (
  id uuid, invoice_no text, vendor_invoice_no text, vendor_name text, po_number text,
  vendor_invoice_date date, due_date date, status public.finance_invoice_status,
  base_value numeric, amount_total numeric, amount_payable numeric,
  requested_amount numeric, remaining numeric, days_due integer,
  cap_bypassed boolean, over_cap boolean,
  can_approve boolean, can_book boolean, can_manage boolean,
  can_raise_payment boolean, can_delete boolean,
  approval_id uuid, stage_label text
)
language sql stable security definer set search_path = public as $$
  select i.id, i.invoice_no, i.vendor_invoice_no, v.name, o.po_number,
         i.vendor_invoice_date, i.due_date, i.status,
         i.base_value, i.amount_total, i.amount_payable,
         i.requested_amount, greatest(0, i.amount_payable - i.requested_amount),
         case when i.status = 'approved'
              then (current_date - i.accounts_approved_at::date) else null end,
         i.cap_bypass_at is not null, public.invoice_over_cap(i.id),
         i.status = 'pending_director' and a.id is not null
           and public.approval_block_reason(a.id) is null,
         public.has_project_permission(i.project_id, 'finance.invoice', 'review'),
         public.has_project_permission(i.project_id, 'finance.invoice', 'manage'),
         public.has_project_permission(i.project_id, 'finance.payment', 'create'),
         public.has_project_permission(i.project_id, 'finance.invoice', 'delete'),
         a.id,
         case when i.status = 'pending_director' then a.stages -> a.current ->> 'label' end
  from public.finance_invoices i
  join public.procurement_vendors v on v.id = i.vendor_id
  join public.procurement_orders o on o.id = i.order_id
  left join public.approval_requests a on a.flow_id = 'invoice' and a.item_id = i.id
  where i.project_id = p_project
    and public.has_project_permission(p_project, 'finance.invoice', 'read')
  order by i.created_at desc;
$$;

grant execute on function public.list_project_invoices(uuid) to authenticated;

drop function if exists public.list_project_payments(uuid);
create function public.list_project_payments(p_project uuid)
returns table (
  id uuid, invoice_no text, vendor_name text, amount numeric, priority text,
  status public.finance_payment_status, notes text, created_at timestamptz,
  can_approve boolean, can_pay boolean,
  approval_id uuid, stage_label text
)
language sql stable security definer set search_path = public as $$
  select pr.id, i.invoice_no, v.name, pr.amount, pr.priority, pr.status, pr.notes, pr.created_at,
         pr.status = 'pending_director' and a.id is not null
           and public.approval_block_reason(a.id) is null,
         public.has_project_permission(pr.project_id, 'finance.payment', 'issue'),
         a.id,
         case when pr.status = 'pending_director' then a.stages -> a.current ->> 'label' end
  from public.finance_payment_requests pr
  join public.finance_invoices i on i.id = pr.invoice_id
  join public.procurement_vendors v on v.id = i.vendor_id
  left join public.approval_requests a on a.flow_id = 'payment' and a.item_id = pr.id
  where pr.project_id = p_project
    and public.has_project_permission(p_project, 'finance.payment', 'read')
  order by case pr.priority when 'high' then 0 when 'medium' then 1 else 2 end, pr.created_at desc;
$$;

grant execute on function public.list_project_payments(uuid) to authenticated;

drop function if exists public.list_project_retention(uuid);
create function public.list_project_retention(p_project uuid)
returns table (
  id uuid, invoice_no text, vendor_name text, amount numeric, due_date date,
  status public.finance_retention_status, is_due boolean,
  early_requested boolean, early_approved boolean,
  can_pay boolean, can_request_early boolean, can_approve_early boolean,
  approval_id uuid, stage_label text
)
language sql stable security definer set search_path = public as $$
  select rt.id, i.invoice_no, v.name, rt.amount, rt.due_date, rt.status,
         (rt.due_date <= current_date or rt.early_approved_at is not null),
         rt.early_requested_at is not null, rt.early_approved_at is not null,
         public.has_project_permission(rt.project_id, 'finance.retention', 'issue'),
         public.has_project_permission(rt.project_id, 'finance.retention', 'update'),
         rt.early_requested_at is not null and rt.early_approved_at is null
           and a.id is not null and public.approval_block_reason(a.id) is null,
         a.id,
         case when a.status = 'pending' then a.stages -> a.current ->> 'label' end
  from public.finance_retention rt
  join public.finance_invoices i on i.id = rt.invoice_id
  join public.procurement_vendors v on v.id = i.vendor_id
  left join public.approval_requests a on a.flow_id = 'retention_early' and a.item_id = rt.id
  where rt.project_id = p_project
    and public.has_project_permission(p_project, 'finance.retention', 'read')
  order by rt.due_date;
$$;

grant execute on function public.list_project_retention(uuid) to authenticated;

drop function if exists public.list_project_finance_orders(uuid);
create function public.list_project_finance_orders(p_project uuid)
returns table (
  id uuid, po_number text, vendor_id uuid, vendor_name text,
  status public.procurement_order_status, po_total numeric,
  acceptance_on_file boolean, fixed_contract boolean,
  contract_start date, contract_end date,
  billing_branch_id uuid, billing_branch_name text,
  advance_requested numeric, advance_tds_pct numeric, advance_payable numeric,
  advance_consumed numeric, advance_remaining numeric,
  advance_approved_at timestamptz, advance_paid_at timestamptz,
  can_set_terms boolean, can_approve_advance boolean, can_pay_advance boolean,
  advance_approval_id uuid, advance_stage_label text
)
language sql stable security definer set search_path = public as $$
  select o.id, o.po_number, o.vendor_id, v.name, o.status,
         public.order_total_value(o.id),
         o.acceptance_file is not null,
         o.fixed_contract, o.contract_start, o.contract_end,
         o.billing_branch_id, bb.name,
         o.advance_requested, o.advance_tds_pct, o.advance_payable,
         o.advance_consumed, public.order_advance_remaining(o.id),
         o.advance_approved_at, o.advance_paid_at,
         public.has_project_permission(o.project_id, 'finance.advance', 'update'),
         coalesce(o.advance_requested, 0) > 0 and o.advance_approved_at is null
           and a.id is not null and public.approval_block_reason(a.id) is null,
         public.has_project_permission(o.project_id, 'finance.advance', 'issue'),
         a.id,
         case when a.status = 'pending' then a.stages -> a.current ->> 'label' end
  from public.procurement_orders o
  join public.procurement_vendors v on v.id = o.vendor_id
  left join public.billing_branches bb on bb.id = o.billing_branch_id
  left join public.approval_requests a on a.flow_id = 'advance' and a.item_id = o.id
  where o.project_id = p_project
    and o.status in ('issued', 'closed', 'amending')
    and public.has_project_permission(p_project, 'finance.advance', 'read')
  order by o.created_at desc;
$$;

grant execute on function public.list_project_finance_orders(uuid) to authenticated;

drop function if exists public.list_project_orders(uuid);
create function public.list_project_orders(p_project uuid)
returns table (
  id uuid, po_number text, vendor_id uuid, vendor_name text,
  status public.procurement_order_status,
  finance_reviewed_by uuid, director_approved_by uuid, issued_at timestamptz,
  cancel_requested boolean, line_count bigint, total numeric, budget_total numeric,
  can_review boolean, can_approve boolean, can_issue boolean, can_receive boolean,
  can_cancel boolean, can_approve_cancel boolean,
  approval_id uuid, approval_status text, stage_label text, can_decide boolean
)
language sql stable security definer set search_path = public as $$
  select o.id, o.po_number, o.vendor_id, v.name, o.status,
         o.finance_reviewed_by, o.director_approved_by, o.issued_at,
         (o.cancel_requested_at is not null and o.status = 'issued'),
         (select count(*) from public.procurement_order_lines ol where ol.order_id = o.id),
         (select coalesce(sum(ol.amount), 0) from public.procurement_order_lines ol where ol.order_id = o.id),
         (select coalesce(sum(ol.qty_ordered * coalesce(ol.budget_rate, 0)), 0)
            from public.procurement_order_lines ol where ol.order_id = o.id),
         public.has_project_permission(o.project_id, 'procurement.order', 'review'),
         public.has_project_permission(o.project_id, 'procurement.order', 'approve'),
         public.has_project_permission(o.project_id, 'procurement.order', 'issue'),
         public.has_project_permission(o.project_id, 'procurement.receipt', 'create'),
         public.has_project_permission(o.project_id, 'procurement.order', 'update'),
         public.has_project_permission(o.project_id, 'procurement.order', 'approve'),
         a.id, a.status,
         case when a.status = 'pending' then a.stages -> a.current ->> 'label' end,
         a.status = 'pending' and public.approval_block_reason(a.id) is null
  from public.procurement_orders o
  join public.procurement_vendors v on v.id = o.vendor_id
  left join public.approval_requests a on a.flow_id = 'order' and a.item_id = o.id
  where o.project_id = p_project
    and public.has_project_permission(p_project, 'procurement.order', 'read')
  order by case o.status
             when 'draft' then 0 when 'amending' then 1 when 'issued' then 2
             when 'closed' then 3 else 4 end,
           o.created_at desc;
$$;

grant execute on function public.list_project_orders(uuid) to authenticated;

drop function if exists public.get_order(uuid);
create function public.get_order(p_order uuid)
returns table (
  id uuid, po_number text, intent_id uuid, vendor_name text, vendor_trade text,
  vendor_type public.procurement_vendor_type,
  vendor_contact_name text, vendor_contact_phone text, vendor_contact_email text,
  vendor_address text, vendor_gstin text,
  status public.procurement_order_status, notes text, version_no integer,
  over_budget boolean, po_file text, acceptance_file text, support_file text,
  finance_reviewed_by uuid, finance_reviewed_name text,
  director_approved_by uuid, director_approved_name text,
  senior_bypass_by uuid, senior_bypass_name text,
  issued_at timestamptz,
  cancel_reason text, cancel_requested_by uuid, cancel_requested_name text,
  cancelled_by uuid, cancelled_name text,
  can_review boolean, can_approve boolean, can_issue boolean, can_receive boolean,
  can_amend boolean, can_cancel boolean, can_approve_cancel boolean, can_bypass boolean,
  approval_id uuid, approval_status text, stage_label text, can_decide boolean
)
language sql stable security definer set search_path = public as $$
  select o.id, o.po_number, o.intent_id,
         v.name, v.trade, v.type,
         v.contact_name, v.contact_phone, v.contact_email,
         v.address, v.gst,
         o.status, o.notes,
         o.version_no, public.order_over_budget_now(o.id),
         o.po_file, o.acceptance_file, o.support_file,
         o.finance_reviewed_by, coalesce(fp.full_name, fp.email),
         o.director_approved_by, coalesce(dp.full_name, dp.email),
         o.senior_bypass_by, coalesce(sp.full_name, sp.email),
         o.issued_at,
         o.cancel_reason, o.cancel_requested_by, coalesce(cp.full_name, cp.email),
         o.cancelled_by, coalesce(xp.full_name, xp.email),
         public.has_project_permission(o.project_id, 'procurement.order', 'review'),
         public.has_project_permission(o.project_id, 'procurement.order', 'approve'),
         public.has_project_permission(o.project_id, 'procurement.order', 'issue'),
         public.has_project_permission(o.project_id, 'procurement.receipt', 'create'),
         public.has_project_permission(o.project_id, 'procurement.order', 'update'),
         public.has_project_permission(o.project_id, 'procurement.order', 'update'),
         public.has_project_permission(o.project_id, 'procurement.order', 'approve'),
         public.has_project_permission(o.project_id, 'procurement.order', 'manage'),
         a.id, a.status,
         case when a.status = 'pending' then a.stages -> a.current ->> 'label' end,
         a.status = 'pending' and public.approval_block_reason(a.id) is null
  from public.procurement_orders o
  join public.procurement_vendors v on v.id = o.vendor_id
  left join public.approval_requests a on a.flow_id = 'order' and a.item_id = o.id
  left join public.profiles fp on fp.id = o.finance_reviewed_by
  left join public.profiles dp on dp.id = o.director_approved_by
  left join public.profiles sp on sp.id = o.senior_bypass_by
  left join public.profiles cp on cp.id = o.cancel_requested_by
  left join public.profiles xp on xp.id = o.cancelled_by
  where o.id = p_order
    and public.has_project_permission(o.project_id, 'procurement.order', 'read');
$$;

grant execute on function public.get_order(uuid) to authenticated;
