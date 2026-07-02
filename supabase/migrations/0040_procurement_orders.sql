-- Studio-Masons ERP — Procurement slice 5: purchase orders + goods receipts
-- Run AFTER 0039_procurement_comparison.sql.
--
-- WHAT THIS ADDS  (see docs/procurement-module-plan.md §2a, §3, §4b)
--   From an AWARDED comparison, one purchase order is created PER WINNING VENDOR
--   (each PO carries that vendor's awarded lines). A PO is signed off by Finance
--   (review) and the Director (approve), then RELEASED by the Procurement Manager
--   (issue) — only once both sign-offs are in. Against a released PO, goods are
--   received in one or more PARTIAL receipts until each line's balance is zero.
--
--   Order verbs: read · issue (release, Proc Mgr) · update (amend) · review
--   (Finance) · approve (Director). Receipt verbs: read · create/update (Proc team).
--
--   FOLLOW-UPS (not in this slice): versioned PO amendments with the MD over-budget
--   escalation, and PO / acceptance-letter file uploads (columns exist, no UI yet).
--   Writes go through SECURITY DEFINER RPCs; RLS carries read policies only.

-- 1. Register the resources ---------------------------------------------------
insert into public.department_modules (department_id, module_id)
select d.id, m.module_id
from public.departments d
cross join (values ('procurement.order'), ('procurement.receipt')) as m(module_id)
where d.key = 'procurement'
on conflict do nothing;

insert into public.module_settings (module_id, is_general) values
  ('procurement.order', false),
  ('procurement.receipt', false)
on conflict (module_id) do nothing;

-- 2. Vocabulary + tables ------------------------------------------------------
do $$ begin
  create type public.procurement_order_status as enum ('draft', 'issued', 'closed');
exception when duplicate_object then null; end $$;

create table if not exists public.procurement_orders (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references public.projects (id) on delete cascade,
  comparison_id        uuid references public.procurement_comparisons (id) on delete set null,
  vendor_id            uuid not null references public.procurement_vendors (id),
  po_number            text,
  status               public.procurement_order_status not null default 'draft',
  notes                text,
  po_file              text,   -- uploaded PO document (follow-up)
  acceptance_file      text,   -- vendor acceptance letter (follow-up)
  finance_reviewed_by  uuid references public.profiles (id),
  finance_reviewed_at  timestamptz,
  director_approved_by uuid references public.profiles (id),
  director_approved_at timestamptz,
  issued_by            uuid references public.profiles (id),
  issued_at            timestamptz,
  prepared_by          uuid references public.profiles (id) default auth.uid(),
  created_at           timestamptz not null default now(),
  unique (comparison_id, vendor_id)
);
create index if not exists procurement_orders_project_idx on public.procurement_orders (project_id);

create table if not exists public.procurement_order_lines (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null references public.procurement_orders (id) on delete cascade,
  budget_line_id     uuid references public.procurement_budget_lines (id),
  comparison_line_id uuid references public.procurement_comparison_lines (id),
  description        text not null,
  unit               text,
  qty_ordered        numeric not null default 0,
  rate               numeric not null default 0,
  amount             numeric generated always as (qty_ordered * rate) stored,
  sort               int not null default 0
);
create index if not exists procurement_order_lines_order_idx on public.procurement_order_lines (order_id);

create table if not exists public.procurement_receipts (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.procurement_orders (id) on delete cascade,
  received_on date not null default current_date,
  notes       text,
  recorded_by uuid references public.profiles (id) default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists procurement_receipts_order_idx on public.procurement_receipts (order_id);

create table if not exists public.procurement_receipt_lines (
  id            uuid primary key default gen_random_uuid(),
  receipt_id    uuid not null references public.procurement_receipts (id) on delete cascade,
  order_line_id uuid not null references public.procurement_order_lines (id) on delete cascade,
  qty_received  numeric not null default 0
);
create index if not exists procurement_receipt_lines_receipt_idx on public.procurement_receipt_lines (receipt_id);

-- 3. Helpers ------------------------------------------------------------------
create or replace function public.procurement_order_project(p_order uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select project_id from public.procurement_orders where id = p_order;
$$;

create or replace function public.can_order(p_order uuid, p_action public.app_action)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.has_project_permission(
    public.procurement_order_project(p_order), 'procurement.order', p_action);
$$;

-- 4. RLS (reads; writes via RPCs) ---------------------------------------------
alter table public.procurement_orders        enable row level security;
alter table public.procurement_order_lines   enable row level security;
alter table public.procurement_receipts      enable row level security;
alter table public.procurement_receipt_lines enable row level security;

drop policy if exists "procurement_orders_select" on public.procurement_orders;
create policy "procurement_orders_select" on public.procurement_orders
  for select using (public.has_project_permission(project_id, 'procurement.order', 'read'));

drop policy if exists "procurement_order_lines_select" on public.procurement_order_lines;
create policy "procurement_order_lines_select" on public.procurement_order_lines
  for select using (public.can_order(order_id, 'read'));

drop policy if exists "procurement_receipts_select" on public.procurement_receipts;
create policy "procurement_receipts_select" on public.procurement_receipts
  for select using (public.can_order(order_id, 'read'));

drop policy if exists "procurement_receipt_lines_select" on public.procurement_receipt_lines;
create policy "procurement_receipt_lines_select" on public.procurement_receipt_lines
  for select using (exists (
    select 1 from public.procurement_receipts r
    where r.id = receipt_id and public.can_order(r.order_id, 'read')
  ));

-- 5. Write RPCs ---------------------------------------------------------------

-- Create one draft PO per winning vendor of an awarded comparison. Skips vendors
-- that already have a PO on this comparison (one PO per vendor).
create or replace function public.create_orders_from_comparison(p_comparison uuid)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_project uuid; v_status public.procurement_comparison_status;
  v_vendor uuid; v_order uuid; v_seq int; v_made int := 0;
begin
  select project_id, status into v_project, v_status
  from public.procurement_comparisons where id = p_comparison;
  if v_project is null then raise exception 'Comparison not found'; end if;
  if not public.has_project_permission(v_project, 'procurement.order', 'issue') then
    raise exception 'Not authorized to raise purchase orders on this project';
  end if;
  if v_status <> 'awarded' then raise exception 'Award the comparison first'; end if;

  for v_vendor in
    select distinct aw.vendor_id
    from public.procurement_comparison_awards aw
    join public.procurement_comparison_lines l on l.id = aw.comparison_line_id
    where l.comparison_id = p_comparison
      and not exists (
        select 1 from public.procurement_orders o
        where o.comparison_id = p_comparison and o.vendor_id = aw.vendor_id
      )
  loop
    select count(*) + 1 into v_seq from public.procurement_orders where project_id = v_project;
    insert into public.procurement_orders (project_id, comparison_id, vendor_id, po_number)
    values (v_project, p_comparison, v_vendor, 'PO-' || lpad(v_seq::text, 3, '0'))
    returning id into v_order;

    insert into public.procurement_order_lines
      (order_id, budget_line_id, comparison_line_id, description, unit, qty_ordered, rate, sort)
    select v_order, l.budget_line_id, l.id, l.description, l.unit, aw.qty, aw.rate, l.sort
    from public.procurement_comparison_awards aw
    join public.procurement_comparison_lines l on l.id = aw.comparison_line_id
    where l.comparison_id = p_comparison and aw.vendor_id = v_vendor;

    v_made := v_made + 1;
  end loop;

  return v_made;
end;
$$;

-- Finance sign-off.
create or replace function public.review_order(p_order uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_project uuid;
begin
  v_project := public.procurement_order_project(p_order);
  if v_project is null then raise exception 'Order not found'; end if;
  if not public.has_project_permission(v_project, 'procurement.order', 'review') then
    raise exception 'Not authorized to review orders (Finance)';
  end if;
  update public.procurement_orders
     set finance_reviewed_by = auth.uid(), finance_reviewed_at = now()
   where id = p_order and status = 'draft';
end;
$$;

-- Director sign-off.
create or replace function public.approve_order(p_order uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_project uuid;
begin
  v_project := public.procurement_order_project(p_order);
  if v_project is null then raise exception 'Order not found'; end if;
  if not public.has_project_permission(v_project, 'procurement.order', 'approve') then
    raise exception 'Not authorized to approve orders (Director)';
  end if;
  update public.procurement_orders
     set director_approved_by = auth.uid(), director_approved_at = now()
   where id = p_order and status = 'draft';
end;
$$;

-- Release the PO — needs both sign-offs. Proc Mgr (issue verb).
create or replace function public.release_order(p_order uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_project uuid; v_status public.procurement_order_status; v_fin uuid; v_dir uuid;
begin
  select project_id, status, finance_reviewed_by, director_approved_by
    into v_project, v_status, v_fin, v_dir
  from public.procurement_orders where id = p_order;
  if v_project is null then raise exception 'Order not found'; end if;
  if not public.has_project_permission(v_project, 'procurement.order', 'issue') then
    raise exception 'Not authorized to release orders';
  end if;
  if v_status <> 'draft' then raise exception 'This PO is already released'; end if;
  if v_fin is null or v_dir is null then
    raise exception 'Both Finance and Director sign-off are needed before release';
  end if;
  update public.procurement_orders
     set status = 'issued', issued_by = auth.uid(), issued_at = now()
   where id = p_order;
end;
$$;

-- Record a (partial) goods receipt against a released PO.
-- p_lines is [{ "order_line_id": "...", "qty": 5 }, ...]
create or replace function public.record_receipt(
  p_order uuid, p_received_on date, p_notes text, p_lines jsonb
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

  insert into public.procurement_receipts (order_id, received_on, notes)
  values (p_order, coalesce(p_received_on, current_date), nullif(trim(p_notes), ''))
  returning id into v_receipt;

  for a in select value from jsonb_array_elements(p_lines) loop
    v_ol  := (a->>'order_line_id')::uuid;
    v_qty := coalesce((a->>'qty')::numeric, 0);
    if v_qty <= 0 then continue; end if;

    -- The line belongs to this PO; the receipt must not exceed the balance.
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

  -- Close the PO once every line is fully received.
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

-- 6. Read RPCs ----------------------------------------------------------------
create or replace function public.list_project_orders(p_project uuid)
returns table (
  id uuid, po_number text, vendor_id uuid, vendor_name text,
  status public.procurement_order_status,
  finance_reviewed_by uuid, director_approved_by uuid,
  issued_at timestamptz,
  line_count bigint, total numeric,
  can_review boolean, can_approve boolean, can_issue boolean, can_receive boolean
)
language sql stable security definer set search_path = public
as $$
  select o.id, o.po_number, o.vendor_id, v.name, o.status,
         o.finance_reviewed_by, o.director_approved_by, o.issued_at,
         (select count(*) from public.procurement_order_lines ol where ol.order_id = o.id),
         (select coalesce(sum(ol.amount), 0) from public.procurement_order_lines ol where ol.order_id = o.id),
         public.has_project_permission(o.project_id, 'procurement.order', 'review'),
         public.has_project_permission(o.project_id, 'procurement.order', 'approve'),
         public.has_project_permission(o.project_id, 'procurement.order', 'issue'),
         public.has_project_permission(o.project_id, 'procurement.receipt', 'create')
  from public.procurement_orders o
  join public.procurement_vendors v on v.id = o.vendor_id
  where o.project_id = p_project
    and public.has_project_permission(p_project, 'procurement.order', 'read')
  order by case o.status when 'draft' then 0 when 'issued' then 1 else 2 end, o.created_at desc;
$$;

-- One PO's header, its lines with received/balance, and its sign-off state.
create or replace function public.get_order(p_order uuid)
returns table (
  id uuid, po_number text, vendor_name text,
  status public.procurement_order_status, notes text,
  finance_reviewed_by uuid, finance_reviewed_name text,
  director_approved_by uuid, director_approved_name text,
  issued_at timestamptz,
  can_review boolean, can_approve boolean, can_issue boolean, can_receive boolean
)
language sql stable security definer set search_path = public
as $$
  select o.id, o.po_number, v.name, o.status, o.notes,
         o.finance_reviewed_by, coalesce(fp.full_name, fp.email),
         o.director_approved_by, coalesce(dp.full_name, dp.email),
         o.issued_at,
         public.has_project_permission(o.project_id, 'procurement.order', 'review'),
         public.has_project_permission(o.project_id, 'procurement.order', 'approve'),
         public.has_project_permission(o.project_id, 'procurement.order', 'issue'),
         public.has_project_permission(o.project_id, 'procurement.receipt', 'create')
  from public.procurement_orders o
  join public.procurement_vendors v on v.id = o.vendor_id
  left join public.profiles fp on fp.id = o.finance_reviewed_by
  left join public.profiles dp on dp.id = o.director_approved_by
  where o.id = p_order
    and public.has_project_permission(o.project_id, 'procurement.order', 'read');
$$;

create or replace function public.get_order_lines(p_order uuid)
returns table (
  id uuid, description text, unit text,
  qty_ordered numeric, rate numeric, amount numeric, qty_received numeric
)
language sql stable security definer set search_path = public
as $$
  select ol.id, ol.description, ol.unit, ol.qty_ordered, ol.rate, ol.amount,
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

-- 7. Seed grants --------------------------------------------------------------
-- Procurement Manager records + releases POs and records receipts; team records
-- receipts. Finance `review` and Director `approve` on orders are company-wide
-- grants assigned via /access.
insert into public.role_permissions (role_id, resource, action)
select r.id, x.resource, x.action::public.app_action
from public.roles r
cross join (values
  ('procurement.order', 'read'),
  ('procurement.order', 'issue'),
  ('procurement.order', 'update'),
  ('procurement.receipt', 'read'),
  ('procurement.receipt', 'create'),
  ('procurement.receipt', 'update')
) as x(resource, action)
where r.key = 'procurement_manager'
on conflict do nothing;

insert into public.role_permissions (role_id, resource, action)
select r.id, x.resource, x.action::public.app_action
from public.roles r
cross join (values
  ('procurement.order', 'read'),
  ('procurement.receipt', 'read'),
  ('procurement.receipt', 'create')
) as x(resource, action)
where r.key = 'procurement_member'
on conflict do nothing;
