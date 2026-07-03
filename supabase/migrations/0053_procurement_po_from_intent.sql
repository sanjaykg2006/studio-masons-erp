-- Studio-Masons ERP — Procurement: purchase orders straight from an approved intent
-- Run AFTER 0052_order_cancelled_status.sql.
--
-- WHAT THIS ADDS  (replaces the Comparison → award → PO path)
--   Once an intent is APPROVED, the Procurement Manager assigns a vendor per budget
--   package and types that vendor's rate for each line, attaching a required
--   supporting document per vendor. Generating creates one draft PO per vendor
--   (packages sharing a vendor MERGE into one PO). Each PO line carries the budgeted
--   rate alongside the vendor rate so the two can be compared; the difference is
--   shown but never gates anything.
--
--   Cancel + re-award: a released PO whose vendor under-performs can be cancelled —
--   the Manager requests it with a reason, a Director approves. Cancelling frees the
--   un-received balance of its lines, which then reappears in the "enter vendor
--   rates" step for re-award to a new vendor (goods already received stay recorded
--   against the cancelled PO and are not re-ordered).
--
--   Writes go through SECURITY DEFINER RPCs; RLS carries read policies only.

-- 1. New columns --------------------------------------------------------------
alter table public.procurement_orders
  add column if not exists intent_id            uuid references public.procurement_intents (id),
  add column if not exists support_file         text,  -- required backup (quote/comparison)
  add column if not exists cancel_reason        text,
  add column if not exists cancel_requested_by  uuid references public.profiles (id),
  add column if not exists cancel_requested_at  timestamptz,
  add column if not exists cancelled_by         uuid references public.profiles (id),
  add column if not exists cancelled_at         timestamptz;
create index if not exists procurement_orders_intent_idx on public.procurement_orders (intent_id);

alter table public.procurement_order_lines
  add column if not exists intent_line_id uuid references public.procurement_intent_lines (id),
  add column if not exists budget_rate    numeric,  -- snapshot of the budgeted rate, for comparison
  add column if not exists location       text;

-- 2. Open-quantity ledger -----------------------------------------------------
-- How much of an approved intent line is still awaiting a vendor: the requested
-- quantity, minus what live (non-cancelled) POs already cover, minus what was
-- already received on any CANCELLED PO (those goods arrived and won't be re-ordered).
create or replace function public.intent_line_open_qty(p_line uuid)
returns numeric
language sql stable security definer set search_path = public
as $$
  select greatest(
    coalesce((select qty_requested from public.procurement_intent_lines where id = p_line), 0)
    - coalesce((
        select sum(ol.qty_ordered)
        from public.procurement_order_lines ol
        join public.procurement_orders o on o.id = ol.order_id
        where ol.intent_line_id = p_line and o.status <> 'cancelled'
      ), 0)
    - coalesce((
        select sum(rl.qty_received)
        from public.procurement_receipt_lines rl
        join public.procurement_order_lines ol on ol.id = rl.order_line_id
        join public.procurement_orders o on o.id = ol.order_id
        where ol.intent_line_id = p_line and o.status = 'cancelled'
      ), 0),
    0);
$$;

-- The approved-intent lines still awaiting a vendor, for the "enter vendor rates"
-- screen. Grouped in the UI by package; only lines with an open quantity appear.
create or replace function public.list_intent_open_lines(p_intent uuid)
returns table (
  intent_line_id uuid, package_id uuid, package_name text,
  ref text, description text, unit text, location text,
  budget_rate numeric, open_qty numeric
)
language sql stable security definer set search_path = public
as $$
  select il.id, pk.id, pk.name,
         bl.ref, bl.description, bl.unit, il.location,
         bl.rate, public.intent_line_open_qty(il.id)
  from public.procurement_intent_lines il
  join public.procurement_intents i on i.id = il.intent_id
  join public.procurement_budget_lines bl on bl.id = il.budget_line_id
  join public.procurement_budget_packages pk on pk.id = bl.package_id
  where il.intent_id = p_intent
    and i.status = 'approved'
    and public.intent_line_open_qty(il.id) > 0
    and public.has_project_permission(i.project_id, 'procurement.order', 'read')
  order by pk.sort, bl.sort;
$$;

-- 3. Generate the purchase orders from an approved intent ---------------------
-- p_lines       : [{ "intent_line_id": "...", "vendor_id": "...", "rate": 4050 }, ...]
-- p_vendor_docs : [{ "vendor_id": "...", "support_file": "storage/path" }, ...]
--   One PO per distinct vendor (its lines merged); each vendor needs a support doc.
create or replace function public.create_orders_from_intent(
  p_intent uuid, p_lines jsonb, p_vendor_docs jsonb
)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_project uuid; v_status public.procurement_intent_status;
  v_vendor uuid; v_order uuid; v_seq int; v_made int := 0;
  v_doc text; v_sort int; a jsonb;
  v_line uuid; v_rate numeric; v_open numeric;
begin
  select project_id, status into v_project, v_status
  from public.procurement_intents where id = p_intent;
  if v_project is null then raise exception 'Intent not found'; end if;
  if not public.has_project_permission(v_project, 'procurement.order', 'issue') then
    raise exception 'Not authorized to raise purchase orders on this project';
  end if;
  if v_status <> 'approved' then raise exception 'The intent must be approved first'; end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'Assign a vendor and rate to at least one line';
  end if;

  -- One PO per distinct vendor named in the lines.
  for v_vendor in
    select distinct (value->>'vendor_id')::uuid from jsonb_array_elements(p_lines)
  loop
    if v_vendor is null then raise exception 'Every line needs a vendor'; end if;
    if not exists (
      select 1 from public.procurement_vendors
      where id = v_vendor and status = 'approved'
    ) then
      raise exception 'A chosen vendor is not an approved vendor in the directory';
    end if;

    -- Its supporting document is required.
    select nullif(trim(vd.value->>'support_file'), '') into v_doc
    from jsonb_array_elements(coalesce(p_vendor_docs, '[]'::jsonb)) vd
    where (vd.value->>'vendor_id')::uuid = v_vendor
    limit 1;
    if v_doc is null then
      raise exception 'Attach a supporting document for every vendor before generating';
    end if;

    select count(*) + 1 into v_seq from public.procurement_orders where project_id = v_project;
    insert into public.procurement_orders (project_id, intent_id, vendor_id, po_number, support_file)
    values (v_project, p_intent, v_vendor, 'PO-' || lpad(v_seq::text, 3, '0'), v_doc)
    returning id into v_order;

    v_sort := 0;
    for a in
      select value from jsonb_array_elements(p_lines)
      where (value->>'vendor_id')::uuid = v_vendor
    loop
      v_line := (a->>'intent_line_id')::uuid;
      v_rate := coalesce((a->>'rate')::numeric, 0);
      if v_rate < 0 then raise exception 'A vendor rate cannot be negative'; end if;

      -- The line must belong to THIS intent, and still have an open quantity.
      if not exists (
        select 1 from public.procurement_intent_lines
        where id = v_line and intent_id = p_intent
      ) then
        raise exception 'A line does not belong to this intent';
      end if;
      v_open := public.intent_line_open_qty(v_line);
      if v_open <= 0 then continue; end if;

      insert into public.procurement_order_lines
        (order_id, budget_line_id, intent_line_id, description, unit, location,
         qty_ordered, rate, budget_rate, sort)
      select v_order, il.budget_line_id, il.id, bl.description, bl.unit, il.location,
             v_open, v_rate, bl.rate, v_sort
      from public.procurement_intent_lines il
      join public.procurement_budget_lines bl on bl.id = il.budget_line_id
      where il.id = v_line;

      v_sort := v_sort + 1;
    end loop;

    -- A vendor whose lines were all already covered leaves an empty PO — drop it.
    if not exists (select 1 from public.procurement_order_lines where order_id = v_order) then
      delete from public.procurement_orders where id = v_order;
    else
      v_made := v_made + 1;
    end if;
  end loop;

  if v_made = 0 then raise exception 'Nothing to order — these lines are already covered'; end if;
  return v_made;
end;
$$;

-- 4. Cancel + re-award --------------------------------------------------------
-- The Procurement Manager requests cancellation of a released PO, with a reason.
create or replace function public.request_order_cancel(p_order uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_project uuid; v_status public.procurement_order_status;
begin
  select project_id, status into v_project, v_status
  from public.procurement_orders where id = p_order;
  if v_project is null then raise exception 'Order not found'; end if;
  if not public.has_project_permission(v_project, 'procurement.order', 'update') then
    raise exception 'Not authorized to request a cancellation';
  end if;
  if v_status <> 'issued' then raise exception 'Only a released PO can be cancelled'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'Give a reason for the cancellation'; end if;

  update public.procurement_orders
     set cancel_requested_by = auth.uid(), cancel_requested_at = now(),
         cancel_reason = trim(p_reason)
   where id = p_order;
end;
$$;

-- A Director approves the cancellation — the PO is cancelled and its un-received
-- balance frees up (via intent_line_open_qty) for re-award to a new vendor.
create or replace function public.approve_order_cancel(p_order uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_project uuid; v_status public.procurement_order_status; v_req timestamptz;
begin
  select project_id, status, cancel_requested_at into v_project, v_status, v_req
  from public.procurement_orders where id = p_order;
  if v_project is null then raise exception 'Order not found'; end if;
  if not public.has_project_permission(v_project, 'procurement.order', 'approve') then
    raise exception 'Not authorized to approve a cancellation (Director)';
  end if;
  if v_req is null then raise exception 'No cancellation has been requested'; end if;
  if v_status <> 'issued' then raise exception 'Only a released PO can be cancelled'; end if;

  update public.procurement_orders
     set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now()
   where id = p_order;
end;
$$;

-- A Director declines the cancellation request — the PO stays live.
create or replace function public.reject_order_cancel(p_order uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_project uuid;
begin
  v_project := public.procurement_order_project(p_order);
  if v_project is null then raise exception 'Order not found'; end if;
  if not public.has_project_permission(v_project, 'procurement.order', 'approve') then
    raise exception 'Not authorized to decide a cancellation (Director)';
  end if;
  update public.procurement_orders
     set cancel_requested_by = null, cancel_requested_at = null, cancel_reason = null
   where id = p_order;
end;
$$;

-- 5. release_order — drop the over-budget gate (budget vs vendor is informational)
create or replace function public.release_order(p_order uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_project uuid; v_status public.procurement_order_status; v_fin uuid; v_dir uuid;
begin
  perform public.recompute_order_over_budget(p_order);
  select project_id, status, finance_reviewed_by, director_approved_by
    into v_project, v_status, v_fin, v_dir
  from public.procurement_orders where id = p_order;
  if v_project is null then raise exception 'Order not found'; end if;
  if not public.has_project_permission(v_project, 'procurement.order', 'issue') then
    raise exception 'Not authorized to release orders';
  end if;
  if v_status not in ('draft', 'amending') then raise exception 'This PO is not awaiting release'; end if;
  if v_fin is null or v_dir is null then
    raise exception 'Both Finance and Director sign-off are needed before release';
  end if;
  update public.procurement_orders
     set status = 'issued', issued_by = auth.uid(), issued_at = now()
   where id = p_order;
end;
$$;

-- 6. Read RPCs (widened) ------------------------------------------------------
drop function if exists public.list_project_orders(uuid);
create or replace function public.list_project_orders(p_project uuid)
returns table (
  id uuid, po_number text, vendor_id uuid, vendor_name text,
  status public.procurement_order_status,
  finance_reviewed_by uuid, director_approved_by uuid,
  issued_at timestamptz, cancel_requested boolean,
  line_count bigint, total numeric, budget_total numeric,
  can_review boolean, can_approve boolean, can_issue boolean,
  can_receive boolean, can_cancel boolean, can_approve_cancel boolean
)
language sql stable security definer set search_path = public
as $$
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
         public.has_project_permission(o.project_id, 'procurement.order', 'approve')
  from public.procurement_orders o
  join public.procurement_vendors v on v.id = o.vendor_id
  where o.project_id = p_project
    and public.has_project_permission(p_project, 'procurement.order', 'read')
  order by case o.status
             when 'draft' then 0 when 'amending' then 1 when 'issued' then 2
             when 'closed' then 3 else 4 end,
           o.created_at desc;
$$;

drop function if exists public.get_order(uuid);
create or replace function public.get_order(p_order uuid)
returns table (
  id uuid, po_number text, intent_id uuid,
  vendor_name text, vendor_trade text, vendor_type public.procurement_vendor_type,
  vendor_contact_name text, vendor_contact_phone text, vendor_contact_email text,
  status public.procurement_order_status, notes text,
  version_no int, over_budget boolean,
  po_file text, acceptance_file text, support_file text,
  finance_reviewed_by uuid, finance_reviewed_name text,
  director_approved_by uuid, director_approved_name text,
  issued_at timestamptz,
  cancel_reason text, cancel_requested_by uuid, cancel_requested_name text,
  cancelled_by uuid, cancelled_name text,
  can_review boolean, can_approve boolean, can_issue boolean,
  can_receive boolean, can_amend boolean,
  can_cancel boolean, can_approve_cancel boolean
)
language sql stable security definer set search_path = public
as $$
  select o.id, o.po_number, o.intent_id,
         v.name, v.trade, v.type,
         v.contact_name, v.contact_phone, v.contact_email,
         o.status, o.notes,
         o.version_no, o.over_budget,
         o.po_file, o.acceptance_file, o.support_file,
         o.finance_reviewed_by, coalesce(fp.full_name, fp.email),
         o.director_approved_by, coalesce(dp.full_name, dp.email),
         o.issued_at,
         o.cancel_reason, o.cancel_requested_by, coalesce(cp.full_name, cp.email),
         o.cancelled_by, coalesce(xp.full_name, xp.email),
         public.has_project_permission(o.project_id, 'procurement.order', 'review'),
         public.has_project_permission(o.project_id, 'procurement.order', 'approve'),
         public.has_project_permission(o.project_id, 'procurement.order', 'issue'),
         public.has_project_permission(o.project_id, 'procurement.receipt', 'create'),
         public.has_project_permission(o.project_id, 'procurement.order', 'update'),
         public.has_project_permission(o.project_id, 'procurement.order', 'update'),
         public.has_project_permission(o.project_id, 'procurement.order', 'approve')
  from public.procurement_orders o
  join public.procurement_vendors v on v.id = o.vendor_id
  left join public.profiles fp on fp.id = o.finance_reviewed_by
  left join public.profiles dp on dp.id = o.director_approved_by
  left join public.profiles cp on cp.id = o.cancel_requested_by
  left join public.profiles xp on xp.id = o.cancelled_by
  where o.id = p_order
    and public.has_project_permission(o.project_id, 'procurement.order', 'read');
$$;

drop function if exists public.get_order_lines(uuid);
create or replace function public.get_order_lines(p_order uuid)
returns table (
  id uuid, description text, unit text, location text,
  qty_ordered numeric, rate numeric, amount numeric,
  budget_rate numeric, qty_received numeric
)
language sql stable security definer set search_path = public
as $$
  select ol.id, ol.description, ol.unit, ol.location,
         ol.qty_ordered, ol.rate, ol.amount, ol.budget_rate,
         coalesce((
           select sum(rl.qty_received) from public.procurement_receipt_lines rl
           where rl.order_line_id = ol.id
         ), 0)
  from public.procurement_order_lines ol
  join public.procurement_orders o on o.id = ol.order_id
  where ol.order_id = p_order
    and public.has_project_permission(o.project_id, 'procurement.order', 'read')
  order by ol.sort;
$$;
