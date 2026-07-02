-- Studio-Masons ERP — Procurement: server-side import RPCs (Budget + Comparison)
-- Run AFTER 0041_procurement_order_docs.sql.
--
-- WHAT THIS ADDS
--   Two RPCs that take already-parsed + reviewed spreadsheet data (the parsing and
--   the review step happen in the app; see src/modules/procurement/import/) and
--   write it in one transaction:
--     * import_budget      — a fresh DRAFT budget version from parsed packages/lines.
--     * import_comparison  — a comparison for one package: its vendors, lines and
--       quotes, binding each line to a budget line by ref/description.

-- 1. Budget import ------------------------------------------------------------
-- p_packages: [{ "name": "...", "lines": [{ "ref","description","unit","qty","rate" }] }]
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
        (package_id, ref, description, unit, qty, rate, sort)
      values (
        v_pkg_id,
        nullif(trim(v_line->>'ref'), ''),
        coalesce(nullif(trim(v_line->>'description'), ''), '(no description)'),
        nullif(trim(v_line->>'unit'), ''),
        coalesce((v_line->>'qty')::numeric, 0),
        coalesce((v_line->>'rate')::numeric, 0),
        v_lsort
      );
      v_lsort := v_lsort + 1;
    end loop;
  end loop;

  return v_budget;
end;
$$;

-- 2. Comparison import --------------------------------------------------------
-- Builds one comparison for a chosen budget package. p_vendors maps parsed vendor
-- names to directory vendor ids; p_lines carries each line's description/ref +
-- per-vendor rate.
--   p_vendors: [{ "vendor_id": "..." }]  (already matched in the review)
--   p_lines:   [{ "ref","description","unit","qty",
--                 "quotes":[{ "vendor_id","rate","make" }] }]
create or replace function public.import_comparison(
  p_project uuid, p_package uuid, p_title text, p_vendors jsonb, p_lines jsonb
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_cmp uuid; v_v jsonb; v_line jsonb; v_line_id uuid; v_q jsonb;
  v_bl uuid; v_sort int := 0;
begin
  if not public.has_project_permission(p_project, 'procurement.comparison', 'create') then
    raise exception 'Not authorized to import a comparison on this project';
  end if;
  if not exists (
    select 1 from public.procurement_budget_packages pk
    join public.procurement_budgets b on b.id = pk.budget_id
    where pk.id = p_package and b.project_id = p_project
  ) then
    raise exception 'That package is not on this project';
  end if;

  insert into public.procurement_comparisons (project_id, package_id, title)
  values (p_project, p_package, nullif(trim(p_title), '')) returning id into v_cmp;

  for v_v in select value from jsonb_array_elements(coalesce(p_vendors, '[]'::jsonb)) loop
    insert into public.procurement_comparison_vendors (comparison_id, vendor_id)
    values (v_cmp, (v_v->>'vendor_id')::uuid) on conflict do nothing;
  end loop;

  for v_line in select value from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    -- Bind to a budget line by ref first, else by description within the package.
    select bl.id into v_bl
    from public.procurement_budget_lines bl
    where bl.package_id = p_package
      and (
        (nullif(trim(v_line->>'ref'), '') is not null and bl.ref = trim(v_line->>'ref'))
        or lower(bl.description) = lower(trim(v_line->>'description'))
      )
    limit 1;

    insert into public.procurement_comparison_lines
      (comparison_id, budget_line_id, description, unit, qty, sort)
    values (
      v_cmp, v_bl,
      coalesce(nullif(trim(v_line->>'description'), ''), '(no description)'),
      nullif(trim(v_line->>'unit'), ''),
      coalesce((v_line->>'qty')::numeric, 0),
      v_sort
    ) returning id into v_line_id;
    v_sort := v_sort + 1;

    for v_q in select value from jsonb_array_elements(coalesce(v_line->'quotes', '[]'::jsonb)) loop
      if nullif(trim(v_q->>'rate'), '') is not null then
        insert into public.procurement_comparison_quotes
          (comparison_line_id, vendor_id, rate, make)
        values (
          v_line_id, (v_q->>'vendor_id')::uuid,
          (v_q->>'rate')::numeric, nullif(trim(v_q->>'make'), '')
        )
        on conflict (comparison_line_id, vendor_id)
          do update set rate = excluded.rate, make = excluded.make;
      end if;
    end loop;
  end loop;

  return v_cmp;
end;
$$;
