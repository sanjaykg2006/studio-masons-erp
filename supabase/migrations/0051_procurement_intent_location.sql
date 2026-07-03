-- Studio-Masons ERP — Procurement: per-line Location on intents + drop auto-fold
-- Run AFTER 0050_drop_comparison.sql.
--
-- WHAT THIS ADDS
--   * A free-text LOCATION captured on each intent line when the intent is raised
--     (e.g. "Workstation", "Conference Room"); may be left blank. It flows through
--     to the purchase-order line so it shows in the PO table.
--   * approve_intent is reverted to a plain approval. The old behaviour (0045/0049)
--     auto-folded an approved line into an existing live PO as an amendment — a
--     Comparison-era shortcut. Under the new flow an approved intent always goes to
--     the "enter vendor rates" step (0053), so the auto-fold is removed.

-- 1. Location column ----------------------------------------------------------
alter table public.procurement_intent_lines
  add column if not exists location text;

-- 2. raise_intent now carries a per-line location -----------------------------
-- p_lines is [{ "budget_line_id": "...", "qty": 12, "location": "Workstation" }, ...]
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
  v_id uuid; v_line jsonb; v_bl uuid; v_qty numeric; v_loc text;
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
    v_loc := nullif(trim(v_line->>'location'), '');
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

    insert into public.procurement_intent_lines
      (intent_id, budget_line_id, qty_requested, location, over_budget)
    values (v_id, v_bl, v_qty, v_loc, (v_committed + v_qty) > v_budgeted);
  end loop;

  return v_id;
end;
$$;

-- 3. approve_intent — plain approval (no auto-fold) ---------------------------
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

-- 4. get_intent_lines now returns location + the budgeted rate ----------------
-- DROP first: widening the returned table.
drop function if exists public.get_intent_lines(uuid);
create or replace function public.get_intent_lines(p_intent uuid)
returns table (
  id uuid, budget_line_id uuid, package_name text,
  ref text, description text, unit text, location text,
  budgeted_qty numeric, budget_rate numeric, qty_requested numeric,
  over_budget boolean, bypass_approved_by uuid, bypass_by_name text
)
language sql stable security definer set search_path = public
as $$
  select il.id, il.budget_line_id, pk.name,
         bl.ref, bl.description, bl.unit, il.location,
         bl.qty, bl.rate, il.qty_requested,
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
