-- Studio-Masons ERP — Procurement: project budget vs expenditure (read-only rollup)
-- Run AFTER 0053_procurement_po_from_intent.sql.
--
-- WHAT THIS ADDS  (no tables — a reporting read only)
--   Two project-level totals for the top of the Budget page:
--     • budget_total      — the latest RELEASED budget version's line amounts (qty × rate).
--     • expenditure_total — value ORDERED on live purchase orders (issued + closed).
--   Draft and cancelled POs are excluded, so expenditure is what the project has
--   actually committed to spend. (A future Finance module can add "amount paid"
--   alongside this — the shape leaves room for it.)
--
--   Gated by procurement.budget:read (the Budget page already requires it); the
--   function is SECURITY DEFINER and re-checks that permission, matching the other
--   procurement read RPCs.

create or replace function public.project_budget_vs_expenditure(p_project uuid)
returns table (budget_total numeric, expenditure_total numeric)
language sql stable security definer set search_path = public
as $$
  select
    -- Budgeted: the latest released version's line amounts.
    coalesce((
      select sum(bl.amount)
      from public.procurement_budgets b
      join public.procurement_budget_packages pk on pk.budget_id = b.id
      join public.procurement_budget_lines bl on bl.package_id = pk.id
      where b.project_id = p_project
        and b.status = 'released'
        and b.version_no = (
          select max(version_no)
          from public.procurement_budgets
          where project_id = p_project and status = 'released'
        )
    ), 0),
    -- Expenditure: ordered value on live POs (issued + closed).
    coalesce((
      select sum(ol.amount)
      from public.procurement_orders o
      join public.procurement_order_lines ol on ol.order_id = o.id
      where o.project_id = p_project
        and o.status in ('issued', 'closed')
    ), 0)
  where public.has_project_permission(p_project, 'procurement.budget', 'read');
$$;
