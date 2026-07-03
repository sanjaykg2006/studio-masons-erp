-- Studio-Masons ERP — Inventory Management
-- Run AFTER 0053_procurement_po_from_intent.sql.
--
-- WHAT THIS ADDS  (see the plan: Inventory Management module)
--   Two things, surfaced as an "Inventory" area on each project (two tabs):
--
--   1. PROJECT MATERIAL (project-scoped, resource `inventory.stock`). The
--      "material list" IS the project's released Budget BOQ — no separate catalog.
--      A PO line already carries its budget_line_id (0040), and receipts reference
--      PO lines, so RECEIVED per budget line is derivable with no new column:
--        received(line) = Σ receipt_lines.qty_received over the project's receipts
--                         where order_line.budget_line_id = line.
--      CONSUMED is recorded by hand on site (this migration's inventory_consumption).
--      ON HAND = received − consumed (never allowed to go negative).
--
--   2. COMPANY ASSETS (company-wide, resource `inventory.asset`). Machines,
--      monitors, printers… Each asset tracks which project it is currently in and
--      its custodian ("under whose leadership"). Moving one to another project is a
--      two-party TRANSFER: the current custodian requests it and names the new
--      custodian, and the NEW CUSTODIAN must ACCEPT before it actually moves.
--
--   Like the rest of Procurement, all writes go through SECURITY DEFINER RPCs; RLS
--   carries read policies only.

-- 1. Register the resources (Procurement + Project Management) -----------------
insert into public.department_modules (department_id, module_id)
select d.id, m.module_id
from public.departments d
cross join (values ('inventory.stock'), ('inventory.asset')) as m(module_id)
where d.key in ('procurement', 'project_management')
on conflict do nothing;

insert into public.module_settings (module_id, is_general) values
  ('inventory.stock', false),
  ('inventory.asset', false)
on conflict (module_id) do nothing;

-- 2. Tables -------------------------------------------------------------------

-- Consumption of a project's material, recorded manually. "Material" = a Budget
-- BOQ line (procurement_budget_lines); no separate catalog.
create table if not exists public.inventory_consumption (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects (id) on delete cascade,
  budget_line_id uuid not null references public.procurement_budget_lines (id) on delete cascade,
  qty            numeric not null check (qty > 0),
  consumed_on    date not null default current_date,
  note           text,
  recorded_by    uuid references public.profiles (id) default auth.uid(),
  created_at     timestamptz not null default now()
);
create index if not exists inventory_consumption_project_idx on public.inventory_consumption (project_id);
create index if not exists inventory_consumption_line_idx    on public.inventory_consumption (budget_line_id);

-- Company assets: a global registry. current_project_id / custodian_id say where
-- the asset is and who is responsible for it right now.
create table if not exists public.inventory_assets (
  id                 uuid primary key default gen_random_uuid(),
  tag                text,                       -- asset tag / serial (optional)
  name               text not null,
  category           text not null default 'other',   -- machine | monitor | printer | other | …
  status             text not null default 'idle',    -- in_use | idle | retired
  current_project_id uuid references public.projects (id) on delete set null,
  custodian_id       uuid references public.profiles (id),
  notes              text,
  created_by         uuid references public.profiles (id) default auth.uid(),
  created_at         timestamptz not null default now()
);
create index if not exists inventory_assets_project_idx on public.inventory_assets (current_project_id);

-- Asset transfers: the two-party handoff between projects.
create table if not exists public.inventory_asset_transfers (
  id              uuid primary key default gen_random_uuid(),
  asset_id        uuid not null references public.inventory_assets (id) on delete cascade,
  from_project_id uuid references public.projects (id) on delete set null,
  to_project_id   uuid references public.projects (id) on delete cascade,
  to_custodian_id uuid not null references public.profiles (id),
  status          text not null default 'pending',   -- pending | accepted | rejected | cancelled
  note            text,
  requested_by    uuid references public.profiles (id) default auth.uid(),
  requested_at    timestamptz not null default now(),
  decided_by      uuid references public.profiles (id),
  decided_at      timestamptz
);
create index if not exists inventory_asset_transfers_asset_idx on public.inventory_asset_transfers (asset_id);

-- 3. RLS (reads; writes via RPCs) ---------------------------------------------
alter table public.inventory_consumption      enable row level security;
alter table public.inventory_assets           enable row level security;
alter table public.inventory_asset_transfers  enable row level security;

drop policy if exists "inventory_consumption_select" on public.inventory_consumption;
create policy "inventory_consumption_select" on public.inventory_consumption
  for select using (public.has_project_permission(project_id, 'inventory.stock', 'read'));

drop policy if exists "inventory_assets_select" on public.inventory_assets;
create policy "inventory_assets_select" on public.inventory_assets
  for select using (public.has_permission('inventory.asset', 'read'));

drop policy if exists "inventory_asset_transfers_select" on public.inventory_asset_transfers;
create policy "inventory_asset_transfers_select" on public.inventory_asset_transfers
  for select using (public.has_permission('inventory.asset', 'read'));

-- 4. Project material RPCs ----------------------------------------------------

-- One row per Budget BOQ line that has been ordered, received or consumed on the
-- project: ordered / received / consumed / on-hand.
create or replace function public.list_project_material_stock(p_project uuid)
returns table (
  budget_line_id uuid,
  package_name   text,
  ref            text,
  description    text,
  unit           text,
  ordered        numeric,
  received       numeric,
  consumed       numeric,
  on_hand        numeric
)
language sql stable security definer set search_path = public
as $$
  with ol as (
    select oln.budget_line_id,
           sum(case when o.status in ('issued', 'closed', 'amending')
                    then oln.qty_ordered else 0 end) as ordered
    from public.procurement_order_lines oln
    join public.procurement_orders o on o.id = oln.order_id
    where o.project_id = p_project and oln.budget_line_id is not null
    group by oln.budget_line_id
  ),
  rc as (
    select oln.budget_line_id, sum(rl.qty_received) as received
    from public.procurement_receipt_lines rl
    join public.procurement_receipts r on r.id = rl.receipt_id
    join public.procurement_orders o on o.id = r.order_id
    join public.procurement_order_lines oln on oln.id = rl.order_line_id
    where o.project_id = p_project and oln.budget_line_id is not null
    group by oln.budget_line_id
  ),
  cons as (
    select budget_line_id, sum(qty) as consumed
    from public.inventory_consumption
    where project_id = p_project
    group by budget_line_id
  ),
  keys as (
    select budget_line_id from ol
    union select budget_line_id from rc
    union select budget_line_id from cons
  )
  select k.budget_line_id, pk.name, bl.ref, bl.description, bl.unit,
         coalesce(ol.ordered, 0),
         coalesce(rc.received, 0),
         coalesce(cons.consumed, 0),
         coalesce(rc.received, 0) - coalesce(cons.consumed, 0)
  from keys k
  join public.procurement_budget_lines bl on bl.id = k.budget_line_id
  join public.procurement_budget_packages pk on pk.id = bl.package_id
  left join ol   on ol.budget_line_id   = k.budget_line_id
  left join rc   on rc.budget_line_id   = k.budget_line_id
  left join cons on cons.budget_line_id = k.budget_line_id
  where public.has_project_permission(p_project, 'inventory.stock', 'read')
  order by pk.sort, bl.sort;
$$;

-- The received-so-far for one budget line on a project (used by the on-hand check).
create or replace function public.inventory_line_received(p_project uuid, p_line uuid)
returns numeric
language sql stable security definer set search_path = public
as $$
  select coalesce(sum(rl.qty_received), 0)
  from public.procurement_receipt_lines rl
  join public.procurement_receipts r on r.id = rl.receipt_id
  join public.procurement_orders o on o.id = r.order_id
  join public.procurement_order_lines oln on oln.id = rl.order_line_id
  where o.project_id = p_project and oln.budget_line_id = p_line;
$$;

-- Record a manual consumption against a budget line — capped at what's on hand.
create or replace function public.record_consumption(
  p_project uuid, p_budget_line uuid, p_qty numeric, p_on date, p_note text
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_received numeric; v_consumed numeric; v_on_hand numeric; v_id uuid;
begin
  if not public.has_project_permission(p_project, 'inventory.stock', 'create') then
    raise exception 'Not authorized to record consumption on this project';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'Enter a quantity greater than zero';
  end if;
  if not exists (
    select 1
    from public.procurement_budget_lines bl
    join public.procurement_budget_packages pk on pk.id = bl.package_id
    join public.procurement_budgets b on b.id = pk.budget_id
    where bl.id = p_budget_line and b.project_id = p_project
  ) then
    raise exception 'That item is not in this project''s budget';
  end if;

  v_received := public.inventory_line_received(p_project, p_budget_line);
  select coalesce(sum(qty), 0) into v_consumed
  from public.inventory_consumption
  where project_id = p_project and budget_line_id = p_budget_line;

  v_on_hand := v_received - v_consumed;
  if p_qty > v_on_hand then
    raise exception 'Only % on hand — cannot consume %', v_on_hand, p_qty;
  end if;

  insert into public.inventory_consumption (project_id, budget_line_id, qty, consumed_on, note)
  values (p_project, p_budget_line, p_qty, coalesce(p_on, current_date), nullif(trim(p_note), ''))
  returning id into v_id;
  return v_id;
end;
$$;

-- The consumption log for a project (newest first).
create or replace function public.list_project_consumption(p_project uuid)
returns table (
  id uuid, budget_line_id uuid, description text, unit text,
  qty numeric, consumed_on date, note text,
  recorded_by uuid, recorded_name text, created_at timestamptz,
  can_delete boolean
)
language sql stable security definer set search_path = public
as $$
  select c.id, c.budget_line_id, bl.description, bl.unit,
         c.qty, c.consumed_on, c.note,
         c.recorded_by, coalesce(p.full_name, p.email), c.created_at,
         public.has_project_permission(c.project_id, 'inventory.stock', 'update')
  from public.inventory_consumption c
  join public.procurement_budget_lines bl on bl.id = c.budget_line_id
  left join public.profiles p on p.id = c.recorded_by
  where c.project_id = p_project
    and public.has_project_permission(p_project, 'inventory.stock', 'read')
  order by c.consumed_on desc, c.created_at desc;
$$;

-- Delete a consumption entry (fix a mis-entry).
create or replace function public.delete_consumption(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_project uuid;
begin
  select project_id into v_project from public.inventory_consumption where id = p_id;
  if v_project is null then raise exception 'Entry not found'; end if;
  if not public.has_project_permission(v_project, 'inventory.stock', 'update') then
    raise exception 'Not authorized to change consumption on this project';
  end if;
  delete from public.inventory_consumption where id = p_id;
end;
$$;

-- 5. Company asset RPCs -------------------------------------------------------

-- Create or edit an asset. p_id null = create (needs create); else edit (update).
create or replace function public.upsert_asset(
  p_id uuid, p_name text, p_category text, p_tag text, p_notes text,
  p_project uuid, p_custodian uuid
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid; v_status text;
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'Enter an asset name'; end if;
  v_status := case when p_project is not null then 'in_use' else 'idle' end;

  if p_id is null then
    if not public.has_permission('inventory.asset', 'create') then
      raise exception 'Not authorized to add assets';
    end if;
    insert into public.inventory_assets
      (name, category, tag, notes, current_project_id, custodian_id, status)
    values (trim(p_name), coalesce(nullif(trim(p_category), ''), 'other'),
            nullif(trim(p_tag), ''), nullif(trim(p_notes), ''),
            p_project, p_custodian, v_status)
    returning id into v_id;
  else
    if not public.has_permission('inventory.asset', 'update') then
      raise exception 'Not authorized to edit assets';
    end if;
    update public.inventory_assets
       set name = trim(p_name),
           category = coalesce(nullif(trim(p_category), ''), 'other'),
           tag = nullif(trim(p_tag), ''),
           notes = nullif(trim(p_notes), '')
     where id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'Asset not found'; end if;
  end if;
  return v_id;
end;
$$;

-- Retire / reactivate an asset (status), or delete it.
create or replace function public.set_asset_status(p_asset uuid, p_status text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_status not in ('in_use', 'idle', 'retired') then
    raise exception 'Unknown status';
  end if;
  if not public.has_permission('inventory.asset', 'update') then
    raise exception 'Not authorized to change assets';
  end if;
  update public.inventory_assets set status = p_status where id = p_asset;
end;
$$;

create or replace function public.delete_asset(p_asset uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.has_permission('inventory.asset', 'delete') then
    raise exception 'Not authorized to remove assets';
  end if;
  delete from public.inventory_assets where id = p_asset;
end;
$$;

-- Directly place an asset in a project + custodian (initial placement / admin fix,
-- no transfer). Needs the update verb.
create or replace function public.assign_asset(p_asset uuid, p_project uuid, p_custodian uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.has_permission('inventory.asset', 'update') then
    raise exception 'Not authorized to assign assets';
  end if;
  update public.inventory_assets
     set current_project_id = p_project,
         custodian_id = p_custodian,
         status = case when p_project is not null then 'in_use' else 'idle' end
   where id = p_asset;
  if not found then raise exception 'Asset not found'; end if;
end;
$$;

-- Request a transfer of an asset to another project + a named new custodian.
create or replace function public.request_asset_transfer(
  p_asset uuid, p_to_project uuid, p_to_custodian uuid, p_note text
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_from uuid; v_status text; v_id uuid;
begin
  if not public.has_permission('inventory.asset', 'update') then
    raise exception 'Not authorized to transfer assets';
  end if;
  if p_to_project is null then raise exception 'Choose a project to transfer to'; end if;
  if p_to_custodian is null then raise exception 'Name the new custodian'; end if;

  select current_project_id, status into v_from, v_status
  from public.inventory_assets where id = p_asset;
  if not found then raise exception 'Asset not found'; end if;
  if v_status = 'retired' then raise exception 'This asset is retired'; end if;
  if exists (
    select 1 from public.inventory_asset_transfers
    where asset_id = p_asset and status = 'pending'
  ) then
    raise exception 'This asset already has a transfer awaiting acceptance';
  end if;

  insert into public.inventory_asset_transfers
    (asset_id, from_project_id, to_project_id, to_custodian_id, note)
  values (p_asset, v_from, p_to_project, p_to_custodian, nullif(trim(p_note), ''))
  returning id into v_id;
  return v_id;
end;
$$;

-- The named new custodian accepts — the asset actually moves.
create or replace function public.accept_asset_transfer(p_transfer uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare t record;
begin
  select * into t from public.inventory_asset_transfers where id = p_transfer;
  if not found then raise exception 'Transfer not found'; end if;
  if t.status <> 'pending' then raise exception 'This transfer is already decided'; end if;
  if t.to_custodian_id <> auth.uid() then
    raise exception 'Only the named new custodian can accept this transfer';
  end if;

  update public.inventory_assets
     set current_project_id = t.to_project_id,
         custodian_id = t.to_custodian_id,
         status = 'in_use'
   where id = t.asset_id;

  update public.inventory_asset_transfers
     set status = 'accepted', decided_by = auth.uid(), decided_at = now()
   where id = p_transfer;
end;
$$;

-- The named new custodian declines.
create or replace function public.reject_asset_transfer(p_transfer uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_to uuid; v_status text;
begin
  select to_custodian_id, status into v_to, v_status
  from public.inventory_asset_transfers where id = p_transfer;
  if v_to is null then raise exception 'Transfer not found'; end if;
  if v_status <> 'pending' then raise exception 'This transfer is already decided'; end if;
  if v_to <> auth.uid() then
    raise exception 'Only the named new custodian can decline this transfer';
  end if;
  update public.inventory_asset_transfers
     set status = 'rejected', decided_by = auth.uid(), decided_at = now()
   where id = p_transfer;
end;
$$;

-- The requester (or an asset manager) cancels a pending transfer.
create or replace function public.cancel_asset_transfer(p_transfer uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_by uuid; v_status text;
begin
  select requested_by, status into v_by, v_status
  from public.inventory_asset_transfers where id = p_transfer;
  if v_by is null then raise exception 'Transfer not found'; end if;
  if v_status <> 'pending' then raise exception 'This transfer is already decided'; end if;
  if v_by <> auth.uid() and not public.has_permission('inventory.asset', 'update') then
    raise exception 'Not authorized to cancel this transfer';
  end if;
  update public.inventory_asset_transfers
     set status = 'cancelled', decided_by = auth.uid(), decided_at = now()
   where id = p_transfer;
end;
$$;

-- 6. Asset read RPCs ----------------------------------------------------------

-- The whole registry, with names + the current pending transfer (if any). Gated
-- on inventory.asset:read (company-wide).
create or replace function public.list_assets()
returns table (
  id uuid, tag text, name text, category text, status text,
  current_project_id uuid, current_project_name text,
  custodian_id uuid, custodian_name text, notes text,
  pending_transfer_id uuid, pending_to_project_name text,
  pending_to_custodian_name text, is_incoming_to_me boolean,
  can_manage boolean
)
language sql stable security definer set search_path = public
as $$
  select a.id, a.tag, a.name, a.category, a.status,
         a.current_project_id, cp.name,
         a.custodian_id, coalesce(cu.full_name, cu.email), a.notes,
         t.id, tp.name, coalesce(tc.full_name, tc.email),
         (t.id is not null and t.to_custodian_id = auth.uid()),
         public.has_permission('inventory.asset', 'update')
  from public.inventory_assets a
  left join public.projects cp on cp.id = a.current_project_id
  left join public.profiles cu on cu.id = a.custodian_id
  left join lateral (
    select id, to_project_id, to_custodian_id
    from public.inventory_asset_transfers
    where asset_id = a.id and status = 'pending'
    order by requested_at desc limit 1
  ) t on true
  left join public.projects tp on tp.id = t.to_project_id
  left join public.profiles tc on tc.id = t.to_custodian_id
  where public.has_permission('inventory.asset', 'read')
  order by a.category, a.name;
$$;

-- Total count of assets per category (the Tab 2 totals strip).
create or replace function public.asset_category_totals()
returns table (category text, count bigint)
language sql stable security definer set search_path = public
as $$
  select category, count(*)
  from public.inventory_assets
  where status <> 'retired' and public.has_permission('inventory.asset', 'read')
  group by category
  order by category;
$$;

-- Pickers for the transfer form: projects + people the caller can see.
create or replace function public.list_asset_projects()
returns table (id uuid, name text)
language sql stable security definer set search_path = public
as $$
  select p.id, p.name
  from public.projects p
  where public.has_permission('inventory.asset', 'read')
  order by p.name;
$$;

create or replace function public.list_asset_people()
returns table (id uuid, name text)
language sql stable security definer set search_path = public
as $$
  select pr.id, coalesce(pr.full_name, pr.email)
  from public.profiles pr
  where public.has_permission('inventory.asset', 'read')
  order by coalesce(pr.full_name, pr.email);
$$;

-- 7. Seed grants --------------------------------------------------------------
-- Procurement Manager + Project Manager: full stock + asset control.
insert into public.role_permissions (role_id, resource, action)
select r.id, x.resource, x.action::public.app_action
from public.roles r
cross join (values
  ('inventory.stock', 'read'), ('inventory.stock', 'create'), ('inventory.stock', 'update'),
  ('inventory.asset', 'read'), ('inventory.asset', 'create'), ('inventory.asset', 'update')
) as x(resource, action)
where r.key in ('procurement_manager', 'pm_project_manager')
on conflict do nothing;

-- Procurement team member: see stock + record consumption; see assets.
insert into public.role_permissions (role_id, resource, action)
select r.id, x.resource, x.action::public.app_action
from public.roles r
cross join (values
  ('inventory.stock', 'read'), ('inventory.stock', 'create'),
  ('inventory.asset', 'read')
) as x(resource, action)
where r.key = 'procurement_member'
on conflict do nothing;
