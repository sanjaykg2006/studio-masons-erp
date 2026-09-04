-- Studio-Masons ERP — keep the Supply / Installation split from the BOQ
-- Run AFTER 0069_realtime_rfi_tasks.sql.
--
-- THE GAP
--   Consolidated BOQs price most items twice: a supply rate and an installation
--   rate, each with its own amount. The importer already FINDS both columns —
--   it then added them together and stored one number, so the split was read
--   from the sheet and thrown away a line later. `supply_rate` / `install_rate`
--   have existed on this table since 0037 and nothing ever wrote to them.
--
-- WHAT THIS ADDS
--   The two amount columns to sit alongside the two rate columns, and an
--   importer that fills all four. Amounts are stored AS PRINTED ON THE SHEET
--   rather than recomputed, so a package always ties back to the document it
--   came from — that is the number that matters when a consultant's total is
--   questioned. (Consultants round; qty × rate does not always equal the amount
--   they printed. The sheet wins.)
--
-- WHAT DOES NOT CHANGE
--   `rate` and `amount` keep their exact present meaning — the combined rate and
--   qty × rate — so intents, purchase orders, vendor rates and every budget-vs-
--   expenditure figure downstream are untouched. The split is additive detail.
--   A sheet with a single rate leaves all four columns null, as before.

alter table public.procurement_budget_lines
  add column if not exists supply_amount  numeric,
  add column if not exists install_amount numeric;

comment on column public.procurement_budget_lines.supply_amount is
  'Supply amount exactly as printed on the source BOQ (null when not split).';
comment on column public.procurement_budget_lines.install_amount is
  'Installation amount exactly as printed on the source BOQ (null when not split).';

-- Importer: carry the four split fields through when the sheet has them.
create or replace function public.import_budget(p_project uuid, p_packages jsonb)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_budget uuid; v_next int; v_pkg jsonb; v_pkg_id uuid; v_line jsonb;
  v_psort int := 0; v_lsort int;
begin
  if not public.has_project_permission(p_project, 'procurement.budget', 'create') then
    raise exception 'Not authorized to import a budget on this project';
  end if;
  if exists (
    select 1 from public.procurement_budgets
    where project_id = p_project and status = 'draft'
  ) then
    raise exception 'There is already a draft budget — release or delete it first';
  end if;
  if p_packages is null or jsonb_array_length(p_packages) = 0 then
    raise exception 'Nothing to import';
  end if;

  select coalesce(max(version_no), 0) + 1 into v_next
  from public.procurement_budgets where project_id = p_project;

  insert into public.procurement_budgets (project_id, version_no, status)
  values (p_project, v_next, 'draft') returning id into v_budget;

  for v_pkg in select value from jsonb_array_elements(p_packages) loop
    insert into public.procurement_budget_packages (budget_id, name, sort)
    values (v_budget, coalesce(nullif(trim(v_pkg->>'name'), ''), 'Package'), v_psort)
    returning id into v_pkg_id;
    v_psort := v_psort + 1;
    v_lsort := 0;

    for v_line in select value from jsonb_array_elements(coalesce(v_pkg->'lines', '[]'::jsonb)) loop
      insert into public.procurement_budget_lines
        (package_id, ref, description, unit, qty, rate,
         supply_rate, install_rate, supply_amount, install_amount, sort)
      values (
        v_pkg_id,
        nullif(trim(v_line->>'ref'), ''),
        coalesce(nullif(trim(v_line->>'description'), ''), '(no description)'),
        nullif(trim(v_line->>'unit'), ''),
        coalesce((v_line->>'qty')::numeric, 0),
        coalesce((v_line->>'rate')::numeric, 0),
        -- Null, not zero: a sheet without the split must stay distinguishable
        -- from one that genuinely quoted nil for installation.
        (v_line->>'supply_rate')::numeric,
        (v_line->>'install_rate')::numeric,
        (v_line->>'supply_amount')::numeric,
        (v_line->>'install_amount')::numeric,
        v_lsort
      );
      v_lsort := v_lsort + 1;
    end loop;
  end loop;

  return v_budget;
end;
$$;
