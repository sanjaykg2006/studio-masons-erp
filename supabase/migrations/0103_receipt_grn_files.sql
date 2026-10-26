-- Studio-Masons ERP — Procurement: GRN + supporting files on goods receipts
-- Run AFTER 0102_budget_release_needs_approval.sql.
--
-- WHAT THIS ADDS
--   Every goods receipt now carries its GRN (goods received note) document, plus
--   any number of extra files (delivery photos, the challan). Bytes live in the
--   existing private `procurement-docs` bucket, written by the service role inside
--   gated server actions; the row here (behind the receipt's RLS) is the boundary.
--
--   * record_receipt REQUIRES a GRN: the server action uploads first and passes the
--     paths in, so the receipt and its files land in one transaction.
--   * Files are add-only. A receipt recorded before this migration (no GRN) can
--     have one attached later, and extras can be added any time — but nothing is
--     ever replaced or removed, so the proof behind a delivery can't be swapped.
--   * list_order_receipts returns each receipt's files.

-- 1. Files table ---------------------------------------------------------------
create table if not exists public.procurement_receipt_files (
  id           uuid primary key default gen_random_uuid(),
  receipt_id   uuid not null references public.procurement_receipts (id) on delete cascade,
  kind         text not null check (kind in ('grn', 'extra')),
  name         text not null,
  storage_path text not null,
  uploaded_by  uuid references public.profiles (id) default auth.uid(),
  created_at   timestamptz not null default now()
);
create index if not exists procurement_receipt_files_receipt_idx
  on public.procurement_receipt_files (receipt_id);
-- One GRN per receipt; extras are unlimited.
create unique index if not exists procurement_receipt_files_one_grn
  on public.procurement_receipt_files (receipt_id) where kind = 'grn';

comment on table public.procurement_receipt_files is
  'GRN + supporting files on a goods receipt. Add-only: never updated or deleted.';

-- Reads follow the PO; writes only through the RPCs below (no write policies).
alter table public.procurement_receipt_files enable row level security;

drop policy if exists "procurement_receipt_files_select" on public.procurement_receipt_files;
create policy "procurement_receipt_files_select" on public.procurement_receipt_files
  for select using (exists (
    select 1 from public.procurement_receipts r
    where r.id = receipt_id and public.can_order(r.order_id, 'read')
  ));

-- 2. Insert one file row, validating shape. Shared by both write paths. -------
create or replace function public.procurement_add_receipt_file_row(
  p_receipt uuid, p_order uuid, p_file jsonb
)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_kind text; v_path text; v_name text;
begin
  v_kind := p_file->>'kind';
  v_path := nullif(trim(p_file->>'path'), '');
  v_name := nullif(trim(p_file->>'name'), '');
  if v_kind not in ('grn', 'extra') then raise exception 'Unknown receipt file kind'; end if;
  if v_path is null or v_name is null then raise exception 'A receipt file is missing its name'; end if;
  -- The server action stores under the PO's folder; anything else is a forged path.
  if v_path not like p_order::text || '/%' then raise exception 'Invalid file path'; end if;
  if v_kind = 'grn' and exists (
    select 1 from public.procurement_receipt_files where receipt_id = p_receipt and kind = 'grn'
  ) then
    raise exception 'This receipt already has a GRN; it cannot be replaced';
  end if;

  insert into public.procurement_receipt_files (receipt_id, kind, name, storage_path)
  values (p_receipt, v_kind, v_name, v_path);
end;
$$;
revoke execute on function public.procurement_add_receipt_file_row(uuid, uuid, jsonb) from public, anon, authenticated;

-- 3. record_receipt now takes the files and insists on a GRN -----------------
-- DROP first: a new parameter would otherwise leave the old overload callable,
-- letting a receipt be recorded with no GRN.
drop function if exists public.record_receipt(uuid, date, text, jsonb, uuid, text);
create or replace function public.record_receipt(
  p_order uuid, p_received_on date, p_notes text, p_lines jsonb,
  p_invoice uuid default null, p_invoice_no text default null,
  p_files jsonb default '[]'::jsonb
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
  if (select count(*) from jsonb_array_elements(coalesce(p_files, '[]'::jsonb)) f
      where f->>'kind' = 'grn') <> 1 then
    raise exception 'Attach the GRN for this delivery';
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

  for a in select value from jsonb_array_elements(p_files) loop
    perform public.procurement_add_receipt_file_row(v_receipt, p_order, a);
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

-- 4. Attach a file to an existing receipt (add-only) --------------------------
-- Not limited to issued POs: the GRN for the last delivery is often scanned after
-- that delivery closed the PO.
create or replace function public.add_receipt_files(p_receipt uuid, p_files jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_order uuid; v_project uuid; a jsonb;
begin
  select r.order_id, o.project_id into v_order, v_project
  from public.procurement_receipts r
  join public.procurement_orders o on o.id = r.order_id
  where r.id = p_receipt;
  if v_order is null then raise exception 'Receipt not found'; end if;
  if not public.has_project_permission(v_project, 'procurement.receipt', 'create') then
    raise exception 'Not authorized to add files to receipts on this project';
  end if;
  if p_files is null or jsonb_array_length(p_files) = 0 then
    raise exception 'Choose a file';
  end if;

  for a in select value from jsonb_array_elements(p_files) loop
    perform public.procurement_add_receipt_file_row(p_receipt, v_order, a);
  end loop;
end;
$$;

-- 5. list_order_receipts returns the files ------------------------------------
-- DROP first: widening the returned table.
drop function if exists public.list_order_receipts(uuid);
create or replace function public.list_order_receipts(p_order uuid)
returns table (
  id uuid, received_on date, notes text,
  recorded_by uuid, recorded_name text, created_at timestamptz,
  invoice_id uuid, invoice_ref text, invoice_no text,
  lines jsonb, files jsonb
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
    ), '[]'::jsonb),
    coalesce((
      -- GRN first, then extras in the order they were added.
      select jsonb_agg(jsonb_build_object('id', f.id, 'kind', f.kind, 'name', f.name)
             order by (f.kind <> 'grn'), f.created_at)
      from public.procurement_receipt_files f
      where f.receipt_id = r.id
    ), '[]'::jsonb)
  from public.procurement_receipts r
  left join public.profiles p          on p.id = r.recorded_by
  left join public.finance_invoices fi on fi.id = r.invoice_id
  where r.order_id = p_order
    and public.can_order(p_order, 'read')
  order by r.received_on desc, r.created_at desc;
$$;
