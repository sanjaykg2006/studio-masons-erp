-- Studio-Masons ERP — undo an amendment, a real receipt history, and a plain
-- answer to "why can't I delete this person?"
-- Run AFTER 0072_rbac_tidy_and_concept_matrix.sql.
--
-- 1. CANCELLING A PO AMENDMENT
--    start_amendment was one-way. Click Amend on a live PO by mistake and it
--    dropped to 'amending' and stayed there until the whole Finance + Director
--    sign-off had been walked again — there was no way back.
--
--    Backing out faithfully needs two things the old code threw away: the
--    sign-offs (start_amendment nulls them and saved them nowhere) and the
--    identity of each line (the snapshot recorded descriptions, so restoring
--    edited quantities meant matching on text). Both are now recorded on the
--    amendment row, so cancel_amendment puts the PO back exactly as it was.
--    procurement_order_amendments is empty today, so the shape change costs
--    nothing.
--
-- 2. RECEIPTS AGAINST AN INVOICE
--    Every receipt is stored but nothing ever displayed them, and none of them
--    referenced the vendor's bill. A receipt may now name an invoice already
--    booked in Finance, or carry the number when the goods arrive first — which
--    is the usual way round.
--
-- 3. WHY A USER CANNOT BE DELETED
--    Deleting a person is blocked by whatever their name is attached to, and
--    the dashboard reported that as a bare 500. user_delete_blockers names the
--    records so they can be cleared and the deletion actually completed.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Amendments: record enough to undo them
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.procurement_order_amendments
  add column if not exists prev_finance_reviewed_by  uuid references public.profiles (id),
  add column if not exists prev_finance_reviewed_at  timestamptz,
  add column if not exists prev_director_approved_by uuid references public.profiles (id),
  add column if not exists prev_director_approved_at timestamptz,
  add column if not exists prev_senior_bypass_by     uuid references public.profiles (id),
  add column if not exists prev_senior_bypass_at     timestamptz,
  add column if not exists cancelled_at              timestamptz;

comment on column public.procurement_order_amendments.prev_finance_reviewed_by is
  'Sign-off held before the amendment opened, so cancelling can put it back.';

create or replace function public.start_amendment(p_order uuid, p_note text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_project uuid;
  v_status  public.procurement_order_status;
  v_ver     int;
  v_snap    jsonb;
  o         public.procurement_orders%rowtype;
begin
  select * into o from public.procurement_orders where id = p_order;
  if o.id is null then raise exception 'Order not found'; end if;
  v_project := o.project_id; v_status := o.status; v_ver := o.version_no;

  if not public.has_project_permission(v_project, 'procurement.order', 'update') then
    raise exception 'Not authorized to amend this PO';
  end if;
  if v_status <> 'issued' then raise exception 'Only a live (issued) PO can be amended'; end if;

  -- Snapshot BY LINE ID as well as description, so cancelling restores the
  -- exact rows rather than guessing from text that may itself have changed.
  select jsonb_agg(jsonb_build_object(
           'id', ol.id, 'description', ol.description,
           'qty_ordered', ol.qty_ordered, 'rate', ol.rate))
    into v_snap
  from public.procurement_order_lines ol where ol.order_id = p_order;

  insert into public.procurement_order_amendments (
    order_id, version_no, note, lines_snapshot,
    prev_finance_reviewed_by, prev_finance_reviewed_at,
    prev_director_approved_by, prev_director_approved_at,
    prev_senior_bypass_by, prev_senior_bypass_at
  )
  values (
    p_order, v_ver, nullif(trim(p_note), ''), v_snap,
    o.finance_reviewed_by, o.finance_reviewed_at,
    o.director_approved_by, o.director_approved_at,
    o.senior_bypass_by, o.senior_bypass_at
  );

  update public.procurement_orders
     set status = 'amending', version_no = version_no + 1,
         finance_reviewed_by = null, finance_reviewed_at = null,
         director_approved_by = null, director_approved_at = null,
         senior_bypass_by = null, senior_bypass_at = null
   where id = p_order;
end;
$$;

-- Put the PO back exactly as it was before the amendment opened.
create or replace function public.cancel_amendment(p_order uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_project uuid;
  v_status  public.procurement_order_status;
  v_amend   public.procurement_order_amendments%rowtype;
  a         jsonb;
begin
  select project_id, status into v_project, v_status
  from public.procurement_orders where id = p_order;
  if v_project is null then raise exception 'Order not found'; end if;
  if not public.has_project_permission(v_project, 'procurement.order', 'update') then
    raise exception 'Not authorized to amend this PO';
  end if;
  if v_status <> 'amending' then
    raise exception 'This PO is not being amended';
  end if;

  select * into v_amend
  from public.procurement_order_amendments
  where order_id = p_order and cancelled_at is null
  order by created_at desc limit 1;
  if v_amend.id is null then
    raise exception 'No open amendment to cancel';
  end if;

  -- Undo any line edits made during the amendment.
  if v_amend.lines_snapshot is not null then
    for a in select value from jsonb_array_elements(v_amend.lines_snapshot) loop
      -- Rows written before this migration have no 'id'; skip rather than
      -- guess, so a cancel never rewrites the wrong line.
      if (a->>'id') is not null then
        update public.procurement_order_lines
           set qty_ordered = coalesce((a->>'qty_ordered')::numeric, qty_ordered),
               rate        = coalesce((a->>'rate')::numeric, rate)
         where id = (a->>'id')::uuid and order_id = p_order;
      end if;
    end loop;
  end if;

  -- Restore the sign-offs the amendment cleared and go back to live.
  update public.procurement_orders
     set status = 'issued',
         version_no = greatest(1, version_no - 1),
         finance_reviewed_by  = v_amend.prev_finance_reviewed_by,
         finance_reviewed_at  = v_amend.prev_finance_reviewed_at,
         director_approved_by = v_amend.prev_director_approved_by,
         director_approved_at = v_amend.prev_director_approved_at,
         senior_bypass_by     = v_amend.prev_senior_bypass_by,
         senior_bypass_at     = v_amend.prev_senior_bypass_at
   where id = p_order;

  -- Kept, not deleted: the trail should show that an amendment was opened and
  -- withdrawn, rather than pretending it never happened.
  update public.procurement_order_amendments
     set cancelled_at = now()
   where id = v_amend.id;

  perform public.recompute_order_over_budget(p_order);
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Receipts: link to the vendor's invoice, and let the history be read
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.procurement_receipts
  add column if not exists invoice_id uuid references public.finance_invoices (id) on delete set null,
  add column if not exists invoice_no text;

comment on column public.procurement_receipts.invoice_id is
  'The booked Finance invoice this delivery was billed under, when it exists.';
comment on column public.procurement_receipts.invoice_no is
  'The vendor bill number, for when goods arrive before the invoice is booked.';

create or replace function public.record_receipt(
  p_order uuid, p_received_on date, p_notes text, p_lines jsonb,
  p_invoice uuid default null, p_invoice_no text default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_project uuid; v_status public.procurement_order_status;
  v_receipt uuid; a jsonb; v_ol uuid; v_qty numeric; v_ordered numeric; v_received numeric;
begin
  select project_id, status into v_project, v_status
  from public.procurement_orders where id = p_order;
  if v_project is null then raise exception 'Order not found'; end if;
  if not public.has_project_permission(v_project, 'procurement.receipt', 'create') then
    raise exception 'Not authorized to record receipts on this project';
  end if;
  if v_status <> 'issued' then raise exception 'Only a released PO can receive goods'; end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'Enter at least one received quantity';
  end if;
  -- A linked invoice must belong to this PO, or the receipt would point at
  -- another order's bill.
  if p_invoice is not null and not exists (
    select 1 from public.finance_invoices where id = p_invoice and order_id = p_order
  ) then
    raise exception 'That invoice does not belong to this purchase order';
  end if;

  insert into public.procurement_receipts (order_id, received_on, notes, invoice_id, invoice_no)
  values (p_order, coalesce(p_received_on, current_date), nullif(trim(p_notes), ''),
          p_invoice, nullif(trim(p_invoice_no), ''))
  returning id into v_receipt;

  for a in select value from jsonb_array_elements(p_lines) loop
    v_ol  := (a->>'order_line_id')::uuid;
    v_qty := coalesce((a->>'qty')::numeric, 0);
    if v_qty <= 0 then continue; end if;

    select qty_ordered into v_ordered
    from public.procurement_order_lines where id = v_ol and order_id = p_order;
    if v_ordered is null then raise exception 'A line is not on this PO'; end if;

    select coalesce(sum(rl.qty_received), 0) into v_received
    from public.procurement_receipt_lines rl
    join public.procurement_receipts r on r.id = rl.receipt_id
    where rl.order_line_id = v_ol and r.order_id = p_order;

    if v_received + v_qty > v_ordered then
      raise exception 'Received quantity exceeds the ordered quantity on a line';
    end if;

    insert into public.procurement_receipt_lines (receipt_id, order_line_id, qty_received)
    values (v_receipt, v_ol, v_qty);
  end loop;

  if not exists (
    select 1 from public.procurement_order_lines ol
    where ol.order_id = p_order
      and ol.qty_ordered > coalesce((
        select sum(rl.qty_received) from public.procurement_receipt_lines rl
        join public.procurement_receipts r on r.id = rl.receipt_id
        where rl.order_line_id = ol.id
      ), 0)
  ) then
    update public.procurement_orders set status = 'closed' where id = p_order;
  end if;

  return v_receipt;
end;
$$;

-- Every goods receipt on a PO, newest first, with what was received on each.
create or replace function public.list_order_receipts(p_order uuid)
returns table (
  id uuid, received_on date, notes text,
  recorded_by uuid, recorded_name text, created_at timestamptz,
  invoice_id uuid, invoice_ref text, invoice_no text,
  lines jsonb
)
language sql stable security definer set search_path = public
as $$
  select
    r.id, r.received_on, r.notes,
    r.recorded_by, coalesce(p.full_name, p.email), r.created_at,
    r.invoice_id,
    coalesce(fi.vendor_invoice_no, fi.invoice_no),
    r.invoice_no,
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'description', ol.description,
               'unit', ol.unit,
               'qty_received', rl.qty_received)
             order by ol.sort)
      from public.procurement_receipt_lines rl
      join public.procurement_order_lines ol on ol.id = rl.order_line_id
      where rl.receipt_id = r.id
    ), '[]'::jsonb)
  from public.procurement_receipts r
  left join public.profiles p          on p.id = r.recorded_by
  left join public.finance_invoices fi on fi.id = r.invoice_id
  where r.order_id = p_order
    and public.can_order(p_order, 'read')
  order by r.received_on desc, r.created_at desc;
$$;

-- Invoices already booked against this PO, for the receipt's invoice picker.
create or replace function public.list_order_invoices(p_order uuid)
returns table (id uuid, label text, vendor_invoice_date date)
language sql stable security definer set search_path = public
as $$
  select i.id,
         coalesce(i.vendor_invoice_no, i.invoice_no) || ' · ' || i.invoice_no,
         i.vendor_invoice_date
  from public.finance_invoices i
  where i.order_id = p_order
    and public.can_order(p_order, 'read')
  order by i.vendor_invoice_date desc;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Why a user cannot be deleted
-- ═══════════════════════════════════════════════════════════════════════════
-- Walks every foreign key that points at profiles and counts the rows still
-- referencing this person. That is exactly the set Postgres refuses the delete
-- over, so the caller can be told what to clear rather than shown a 500.
create or replace function public.user_delete_blockers(p_user uuid)
returns table (table_name text, column_name text, row_count bigint)
language plpgsql stable security definer set search_path = public
as $$
declare
  r record;
  n bigint;
begin
  if not public.has_permission('access', 'delete') then
    raise exception 'Not authorized to remove users';
  end if;

  for r in
    select c.relname as tbl, a.attname as col
    from pg_constraint fk
    join pg_class     c on c.oid = fk.conrelid
    join pg_namespace ns on ns.oid = c.relnamespace
    join pg_attribute a on a.attrelid = fk.conrelid and a.attnum = fk.conkey[1]
    where fk.contype = 'f'
      and fk.confrelid = 'public.profiles'::regclass
      and cardinality(fk.conkey) = 1
      and ns.nspname = 'public'
      and c.relkind = 'r'
      -- Rows that follow the person out of the system anyway.
      and fk.confdeltype in ('a', 'r')   -- NO ACTION / RESTRICT only
  loop
    execute format('select count(*) from public.%I where %I = $1', r.tbl, r.col)
      into n using p_user;
    if n > 0 then
      table_name := r.tbl; column_name := r.col; row_count := n;
      return next;
    end if;
  end loop;
end;
$$;
