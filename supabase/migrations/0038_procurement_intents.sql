-- Studio-Masons ERP — Procurement slice 3: purchase intents (per-project)
-- Run AFTER 0037_procurement_budget.sql.
--
-- WHAT THIS ADDS  (see docs/procurement-module-plan.md §2a, §3)
--   A Project Manager RAISES a purchase intent against released Budget BOQ lines.
--   Each intent line names a budget line + a requested quantity; if the cumulative
--   approved quantity on that budget line would exceed the budgeted quantity, the
--   line is flagged OVER-BUDGET. The Director APPROVES an intent (the `approve`
--   verb); approving clears the intent-stage over-budget bypass on its lines. The
--   raiser can withdraw their own pending intent.
--
--   Cross-department note: intents are created by the Project Manager (a PM-
--   department role) but the resource is Procurement's, so `procurement.intent` is
--   registered to BOTH departments (mirrors how PM already holds project.*).
--
--   Like the RFI system, ALL writes go through SECURITY DEFINER RPCs; RLS carries
--   read policies only.

-- 1. Register the resource (Procurement + Project Management) ------------------
insert into public.department_modules (department_id, module_id)
select d.id, 'procurement.intent'
from public.departments d
where d.key in ('procurement', 'project_management')
on conflict do nothing;

insert into public.module_settings (module_id, is_general)
values ('procurement.intent', false)
on conflict (module_id) do nothing;

-- 2. Vocabulary + tables ------------------------------------------------------
do $$ begin
  create type public.procurement_intent_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

create table if not exists public.procurement_intents (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  status      public.procurement_intent_status not null default 'pending',
  needed_by   date,
  notes       text,
  raised_by   uuid references public.profiles (id) default auth.uid(),
  created_at  timestamptz not null default now(),
  approved_by uuid references public.profiles (id),
  approved_at timestamptz
);
create index if not exists procurement_intents_project_idx on public.procurement_intents (project_id);

create table if not exists public.procurement_intent_lines (
  id                 uuid primary key default gen_random_uuid(),
  intent_id          uuid not null references public.procurement_intents (id) on delete cascade,
  budget_line_id     uuid not null references public.procurement_budget_lines (id),
  qty_requested      numeric not null default 0,
  over_budget        boolean not null default false,
  bypass_approved_by uuid references public.profiles (id)
);
create index if not exists procurement_intent_lines_intent_idx on public.procurement_intent_lines (intent_id);

-- 3. Helper -------------------------------------------------------------------
create or replace function public.procurement_intent_project(p_intent uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select project_id from public.procurement_intents where id = p_intent;
$$;

-- 4. RLS (reads; writes go through the RPCs below) ----------------------------
alter table public.procurement_intents      enable row level security;
alter table public.procurement_intent_lines enable row level security;

drop policy if exists "procurement_intents_select" on public.procurement_intents;
create policy "procurement_intents_select" on public.procurement_intents
  for select using (public.has_project_permission(project_id, 'procurement.intent', 'read'));

drop policy if exists "procurement_intent_lines_select" on public.procurement_intent_lines;
create policy "procurement_intent_lines_select" on public.procurement_intent_lines
  for select using (
    public.has_project_permission(
      public.procurement_intent_project(intent_id), 'procurement.intent', 'read')
  );

-- 5. Write RPCs ---------------------------------------------------------------

-- Raise an intent against one or more released budget lines.
-- p_lines is a JSON array: [{ "budget_line_id": "...", "qty": 12 }, ...]
create or replace function public.raise_intent(
  p_project   uuid,
  p_needed_by date,
  p_notes     text,
  p_lines     jsonb
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid; v_line jsonb; v_bl uuid; v_qty numeric;
  v_budgeted numeric; v_committed numeric;
begin
  if not public.has_project_permission(p_project, 'procurement.intent', 'create') then
    raise exception 'Not authorized to raise an intent on this project';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one line';
  end if;

  insert into public.procurement_intents (project_id, needed_by, notes)
  values (p_project, p_needed_by, nullif(trim(p_notes), ''))
  returning id into v_id;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_bl  := (v_line->>'budget_line_id')::uuid;
    v_qty := coalesce((v_line->>'qty')::numeric, 0);
    if v_qty <= 0 then raise exception 'Each line needs a quantity above zero'; end if;

    -- The budget line must belong to this project.
    select bl.qty into v_budgeted
    from public.procurement_budget_lines bl
    join public.procurement_budget_packages pk on pk.id = bl.package_id
    join public.procurement_budgets b on b.id = pk.budget_id
    where bl.id = v_bl and b.project_id = p_project;
    if v_budgeted is null then raise exception 'That budget line is not on this project'; end if;

    -- Already-committed (approved) quantity on this budget line.
    select coalesce(sum(il.qty_requested), 0) into v_committed
    from public.procurement_intent_lines il
    join public.procurement_intents i on i.id = il.intent_id
    where il.budget_line_id = v_bl and i.status = 'approved';

    insert into public.procurement_intent_lines (intent_id, budget_line_id, qty_requested, over_budget)
    values (v_id, v_bl, v_qty, (v_committed + v_qty) > v_budgeted);
  end loop;

  return v_id;
end;
$$;

-- Approve an intent (Director). Also clears the intent-stage over-budget bypass.
create or replace function public.approve_intent(p_intent uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_project uuid; v_status public.procurement_intent_status;
begin
  select project_id, status into v_project, v_status
  from public.procurement_intents where id = p_intent;
  if v_project is null then raise exception 'Intent not found'; end if;
  if not public.has_project_permission(v_project, 'procurement.intent', 'approve') then
    raise exception 'Not authorized to approve intents on this project';
  end if;
  if v_status <> 'pending' then raise exception 'Only a pending intent can be approved'; end if;

  update public.procurement_intents
     set status = 'approved', approved_by = auth.uid(), approved_at = now()
   where id = p_intent;
  update public.procurement_intent_lines
     set bypass_approved_by = auth.uid()
   where intent_id = p_intent and over_budget and bypass_approved_by is null;
end;
$$;

-- Reject an intent (Director).
create or replace function public.reject_intent(p_intent uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_project uuid; v_status public.procurement_intent_status;
begin
  select project_id, status into v_project, v_status
  from public.procurement_intents where id = p_intent;
  if v_project is null then raise exception 'Intent not found'; end if;
  if not public.has_project_permission(v_project, 'procurement.intent', 'approve') then
    raise exception 'Not authorized to decide intents on this project';
  end if;
  if v_status <> 'pending' then raise exception 'Only a pending intent can be rejected'; end if;
  update public.procurement_intents set status = 'rejected' where id = p_intent;
end;
$$;

-- Withdraw a pending intent — its raiser, or someone who can approve.
create or replace function public.withdraw_intent(p_intent uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_project uuid; v_by uuid; v_status public.procurement_intent_status;
begin
  select project_id, raised_by, status into v_project, v_by, v_status
  from public.procurement_intents where id = p_intent;
  if v_project is null then raise exception 'Intent not found'; end if;
  if not (
    (v_by = auth.uid() and v_status = 'pending')
    or public.has_project_permission(v_project, 'procurement.intent', 'approve')
  ) then
    raise exception 'Not authorized to withdraw this intent';
  end if;
  delete from public.procurement_intents where id = p_intent;
end;
$$;

-- 6. Read RPCs ----------------------------------------------------------------
create or replace function public.list_project_intents(p_project uuid)
returns table (
  id uuid, status public.procurement_intent_status,
  needed_by date, notes text,
  raised_by uuid, raiser_name text, created_at timestamptz,
  approved_by uuid, approver_name text, approved_at timestamptz,
  line_count bigint, total_qty numeric, over_budget_any boolean,
  can_approve boolean, can_withdraw boolean
)
language sql stable security definer set search_path = public
as $$
  select i.id, i.status, i.needed_by, i.notes,
         i.raised_by, coalesce(rp.full_name, rp.email), i.created_at,
         i.approved_by, coalesce(ap.full_name, ap.email), i.approved_at,
         (select count(*) from public.procurement_intent_lines il where il.intent_id = i.id),
         (select coalesce(sum(il.qty_requested), 0) from public.procurement_intent_lines il where il.intent_id = i.id),
         exists (select 1 from public.procurement_intent_lines il where il.intent_id = i.id and il.over_budget),
         public.has_project_permission(i.project_id, 'procurement.intent', 'approve'),
         (i.raised_by = auth.uid() and i.status = 'pending')
  from public.procurement_intents i
  left join public.profiles rp on rp.id = i.raised_by
  left join public.profiles ap on ap.id = i.approved_by
  where i.project_id = p_project
    and public.has_project_permission(p_project, 'procurement.intent', 'read')
  order by case i.status when 'pending' then 0 when 'approved' then 1 else 2 end,
           i.created_at desc;
$$;

create or replace function public.get_intent_lines(p_intent uuid)
returns table (
  id uuid, budget_line_id uuid, package_name text,
  ref text, description text, unit text,
  budgeted_qty numeric, qty_requested numeric,
  over_budget boolean, bypass_approved_by uuid, bypass_by_name text
)
language sql stable security definer set search_path = public
as $$
  select il.id, il.budget_line_id, pk.name,
         bl.ref, bl.description, bl.unit,
         bl.qty, il.qty_requested,
         il.over_budget, il.bypass_approved_by, coalesce(bp.full_name, bp.email)
  from public.procurement_intent_lines il
  join public.procurement_budget_lines bl on bl.id = il.budget_line_id
  join public.procurement_budget_packages pk on pk.id = bl.package_id
  join public.procurement_intents i on i.id = il.intent_id
  left join public.profiles bp on bp.id = il.bypass_approved_by
  where il.intent_id = p_intent
    and public.has_project_permission(i.project_id, 'procurement.intent', 'read')
  order by pk.sort, bl.sort;
$$;

-- The released budget's lines, with committed qty, for the "raise intent" picker.
create or replace function public.list_released_budget_lines(p_project uuid)
returns table (
  budget_line_id uuid, package_name text,
  ref text, description text, unit text,
  budgeted_qty numeric, committed_qty numeric
)
language sql stable security definer set search_path = public
as $$
  with rel as (
    select id from public.procurement_budgets
    where project_id = p_project and status = 'released'
    order by version_no desc limit 1
  )
  select bl.id, pk.name, bl.ref, bl.description, bl.unit, bl.qty,
         coalesce((
           select sum(il.qty_requested)
           from public.procurement_intent_lines il
           join public.procurement_intents i on i.id = il.intent_id
           where il.budget_line_id = bl.id and i.status = 'approved'
         ), 0)
  from public.procurement_budget_lines bl
  join public.procurement_budget_packages pk on pk.id = bl.package_id
  join rel on rel.id = pk.budget_id
  where public.has_project_permission(p_project, 'procurement.intent', 'read')
  order by pk.sort, bl.sort;
$$;

-- 7. Seed grants --------------------------------------------------------------
-- Procurement team can see intents; the Project Manager raises them. Director's
-- `approve` stays a company-wide grant assigned via /access.
insert into public.role_permissions (role_id, resource, action)
select r.id, 'procurement.intent', 'read'::public.app_action
from public.roles r
where r.key in ('procurement_manager', 'procurement_member')
on conflict do nothing;

insert into public.role_permissions (role_id, resource, action)
select r.id, 'procurement.intent', x.action::public.app_action
from public.roles r
cross join (values ('read'), ('create')) as x(action)
where r.key = 'pm_project_manager'
on conflict do nothing;
