-- Studio-Masons ERP — Procurement: remove the Comparison feature entirely
-- Run AFTER 0049_fix_approve_intent_alias.sql.
--
-- WHY
--   The multi-quote Comparison grid is being replaced by a simpler manual step:
--   after an intent is approved, the Procurement Manager enters the chosen vendor's
--   rate per line directly (see 0053). Nothing depends on comparisons any more, so
--   this drops the whole slice — its tables, RPCs, project-vendor approvals, and the
--   `procurement.comparison` access resource — and severs the order → comparison link.
--
--   This is destructive: any existing comparison / project-vendor-approval data is
--   removed. Purchase orders and their lines are kept; only the (now unused)
--   comparison_id / comparison_line_id columns are dropped.

-- 1. Sever the order → comparison link ----------------------------------------
-- Dropping comparison_id also drops its unique (comparison_id, vendor_id) constraint.
alter table public.procurement_orders      drop column if exists comparison_id;
alter table public.procurement_order_lines drop column if exists comparison_line_id;

-- 2. Drop the comparison RPCs -------------------------------------------------
drop function if exists public.create_orders_from_comparison(uuid);
drop function if exists public.import_comparison(uuid, uuid, text, jsonb, jsonb);
drop function if exists public.list_project_comparisons(uuid);
drop function if exists public.list_project_vendors(uuid);
drop function if exists public.award_comparison(uuid, jsonb);
drop function if exists public.set_quote(uuid, uuid, uuid, numeric, text);
drop function if exists public.remove_comparison_vendor(uuid, uuid);
drop function if exists public.add_comparison_vendor(uuid, uuid);
drop function if exists public.create_comparison(uuid, uuid, text);
drop function if exists public.set_project_vendor(uuid, uuid, boolean);
drop function if exists public.procurement_comparison_line_cmp(uuid);
drop function if exists public.can_comparison(uuid, public.app_action);
drop function if exists public.procurement_comparison_project(uuid);

-- 3. Drop the comparison tables (children first) ------------------------------
drop table if exists public.procurement_comparison_awards;
drop table if exists public.procurement_comparison_quotes;
drop table if exists public.procurement_comparison_lines;
drop table if exists public.procurement_comparison_vendors;
drop table if exists public.procurement_vendor_project_approvals;
drop table if exists public.procurement_comparisons;

drop type if exists public.procurement_comparison_status;

-- 4. Unregister the `procurement.comparison` access resource ------------------
delete from public.role_permissions where resource = 'procurement.comparison';
delete from public.department_modules where module_id = 'procurement.comparison';
delete from public.module_settings   where module_id = 'procurement.comparison';
