-- Studio-Masons ERP — Procurement: all-projects visibility + verb refinements
-- Run AFTER 0055_procurement_budget_vs_expenditure.sql.
--
-- WHAT THIS ADDS  (decisions taken with the user, 2026-07-04)
--   Procurement (and any cross-cutting department like Finance/Director) should
--   SEE every project automatically, while what each person may DO on a project
--   stays governed by the permission matrix. Four independent changes:
--
--   A. All-projects visibility. Register the Projects module to the Procurement
--      department and give its roles `project:read`, so a procurement person set
--      to "works on all projects" (Team Access switch) can actually see and open
--      every project. Also fix has_project_access() — the /projects landing + the
--      sidebar link — to honour that all-projects switch (today it only checks a
--      global grant or membership, so a pure all-projects person was locked out).
--
--   B. No pre-filled sign-off on an auto-amended PO. Approving an intent may still
--      fold into a live PO as an amendment, but it must NOT pre-fill the Director's
--      sign-off — the amendment goes through the full Finance + Director sign-off
--      again, like any other.
--
--   C. Over-budget PO release is matrix-controlled. The senior over-budget bypass
--      was hard-wired to the top super-admin ('*'); make it the grantable verb
--      `procurement.order:manage` instead, and re-expose it on get_order so the UI
--      can offer the button (it was dropped in the 0053 redesign).
--
--   D. Direct asset moves are senior-only. Directly placing/moving an asset now
--      needs `inventory.asset:delete` (the senior verb) — everyone else must use
--      the request → accept transfer. (Delete already used this verb.)

-- ── A. All-projects visibility for Procurement ───────────────────────────────

-- Register the Projects module to Procurement so its roles may hold project:read
-- (the 0031 guard only lets a role hold its own department's modules).
insert into public.department_modules (department_id, module_id)
select d.id, 'project'
from public.departments d
where d.key = 'procurement'
on conflict do nothing;

-- Give both procurement roles the "see a project" key. Only `read`: procurement
-- views every project to do its buying; editing the project itself stays with the
-- project's own department. Held company-wide (global role or the all-projects
-- switch), this is what makes every project visible.
insert into public.role_permissions (role_id, resource, action)
select r.id, 'project', 'read'::public.app_action
from public.roles r
where r.key in ('procurement_manager', 'procurement_member')
on conflict do nothing;

-- Fix the Projects landing + sidebar gate to honour the "works on all projects"
-- switch. Previously: a global project:read grant OR membership on any project.
-- Now also: an all-projects team member whose chosen role carries project:read.
create or replace function public.has_project_access()
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    public.has_permission('project', 'read')
    or exists (
      select 1 from public.project_members m where m.user_id = auth.uid()
    )
    or exists (
      select 1
      from public.team_members tm
      join public.role_permissions rp on rp.role_id = tm.all_projects_role_id
      where tm.user_id = auth.uid()
        and tm.all_projects
        and rp.action = 'read'
        and rp.resource in ('project', '*')
    );
$$;

-- ── B. No pre-filled sign-off when an approved intent auto-amends a PO ────────
-- Same as 0045 but the auto-routed amendment no longer carries the Director's
-- sign-off — it clears every sign-off, so the amendment is re-reviewed by Finance
-- and re-approved by the Director before it can be re-released.
create or replace function public.approve_intent(p_intent uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_project uuid; v_status public.procurement_intent_status;
  il record; v_ol uuid; v_order uuid; v_ver int;
  v_touched uuid[] := '{}';
  v_o uuid;
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

  -- Auto-route each line that already has a live PO into a PO amendment.
  for il in
    select il.budget_line_id, il.qty_requested
    from public.procurement_intent_lines il
    where il.intent_id = p_intent and il.budget_line_id is not null
  loop
    v_ol := null; v_order := null;
    select ol.id, o.id into v_ol, v_order
    from public.procurement_order_lines ol
    join public.procurement_orders o on o.id = ol.order_id
    where ol.budget_line_id = il.budget_line_id
      and o.project_id = v_project
      and o.status in ('issued', 'amending', 'closed')
    order by case o.status when 'amending' then 0 when 'issued' then 1 else 2 end,
             o.created_at desc
    limit 1;
    if v_ol is null then continue; end if;  -- no PO yet: normal manual path

    if not (v_order = any (v_touched)) then
      -- Only open a fresh amendment if the PO isn't already being amended. Either
      -- way, NO sign-off is pre-filled — the amendment runs the full process.
      if (select status from public.procurement_orders where id = v_order) <> 'amending' then
        select version_no into v_ver from public.procurement_orders where id = v_order;
        insert into public.procurement_order_amendments
          (order_id, version_no, note, originating_intent_id, lines_snapshot)
        select v_order, v_ver, 'Auto-routed from an approved intent', p_intent,
               (select jsonb_agg(jsonb_build_object(
                          'description', ol.description, 'qty_ordered', ol.qty_ordered, 'rate', ol.rate))
                from public.procurement_order_lines ol where ol.order_id = v_order);
        update public.procurement_orders
           set status = 'amending', version_no = version_no + 1,
               finance_reviewed_by = null, finance_reviewed_at = null,
               director_approved_by = null, director_approved_at = null,
               senior_bypass_by = null, senior_bypass_at = null
         where id = v_order;
      end if;
      v_touched := array_append(v_touched, v_order);
    end if;

    update public.procurement_order_lines
       set qty_ordered = qty_ordered + il.qty_requested
     where id = v_ol;
  end loop;

  foreach v_o in array v_touched loop
    perform public.recompute_order_over_budget(v_o);
  end loop;
end;
$$;

-- ── C. Over-budget PO bypass → the matrix verb procurement.order:manage ───────

-- A read-only over-budget check (no UPDATE), so get_order can show the true state
-- and offer the bypass button before any release is attempted. Same rule as
-- recompute_order_over_budget.
create or replace function public.order_over_budget_now(p_order uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.procurement_order_lines ol
    join public.procurement_budget_lines bl on bl.id = ol.budget_line_id
    where ol.order_id = p_order
      and ol.qty_ordered + coalesce((
        select sum(ol2.qty_ordered)
        from public.procurement_order_lines ol2
        join public.procurement_orders o2 on o2.id = ol2.order_id
        where ol2.budget_line_id = ol.budget_line_id
          and o2.id <> p_order
          and o2.status in ('issued', 'closed', 'amending')
      ), 0) > bl.qty
  );
$$;

-- The bypass now checks a grantable verb instead of the '*' super-admin. The MD's
-- wildcard still satisfies it (resource '*'), and a "Director/MD" role can now be
-- given procurement.order:manage in the matrix.
create or replace function public.senior_bypass_order(p_order uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_project uuid;
begin
  v_project := public.procurement_order_project(p_order);
  if v_project is null then raise exception 'Order not found'; end if;
  if not public.has_project_permission(v_project, 'procurement.order', 'manage') then
    raise exception 'Not authorized to clear an over-budget PO';
  end if;
  update public.procurement_orders
     set senior_bypass_by = auth.uid(), senior_bypass_at = now()
   where id = p_order;
end;
$$;

-- Re-expose over-budget + the senior bypass on get_order (the 0053 redesign
-- dropped them). Rebuilds the 0053 shape and appends senior_bypass_by /
-- senior_bypass_name / can_bypass, and computes over_budget live.
drop function if exists public.get_order(uuid);
create or replace function public.get_order(p_order uuid)
returns table (
  id uuid, po_number text, intent_id uuid,
  vendor_name text, vendor_trade text, vendor_type public.procurement_vendor_type,
  vendor_contact_name text, vendor_contact_phone text, vendor_contact_email text,
  status public.procurement_order_status, notes text,
  version_no int, over_budget boolean,
  po_file text, acceptance_file text, support_file text,
  finance_reviewed_by uuid, finance_reviewed_name text,
  director_approved_by uuid, director_approved_name text,
  senior_bypass_by uuid, senior_bypass_name text,
  issued_at timestamptz,
  cancel_reason text, cancel_requested_by uuid, cancel_requested_name text,
  cancelled_by uuid, cancelled_name text,
  can_review boolean, can_approve boolean, can_issue boolean,
  can_receive boolean, can_amend boolean,
  can_cancel boolean, can_approve_cancel boolean, can_bypass boolean
)
language sql stable security definer set search_path = public
as $$
  select o.id, o.po_number, o.intent_id,
         v.name, v.trade, v.type,
         v.contact_name, v.contact_phone, v.contact_email,
         o.status, o.notes,
         o.version_no, public.order_over_budget_now(o.id),
         o.po_file, o.acceptance_file, o.support_file,
         o.finance_reviewed_by, coalesce(fp.full_name, fp.email),
         o.director_approved_by, coalesce(dp.full_name, dp.email),
         o.senior_bypass_by, coalesce(sp.full_name, sp.email),
         o.issued_at,
         o.cancel_reason, o.cancel_requested_by, coalesce(cp.full_name, cp.email),
         o.cancelled_by, coalesce(xp.full_name, xp.email),
         public.has_project_permission(o.project_id, 'procurement.order', 'review'),
         public.has_project_permission(o.project_id, 'procurement.order', 'approve'),
         public.has_project_permission(o.project_id, 'procurement.order', 'issue'),
         public.has_project_permission(o.project_id, 'procurement.receipt', 'create'),
         public.has_project_permission(o.project_id, 'procurement.order', 'update'),
         public.has_project_permission(o.project_id, 'procurement.order', 'update'),
         public.has_project_permission(o.project_id, 'procurement.order', 'approve'),
         public.has_project_permission(o.project_id, 'procurement.order', 'manage')
  from public.procurement_orders o
  join public.procurement_vendors v on v.id = o.vendor_id
  left join public.profiles fp on fp.id = o.finance_reviewed_by
  left join public.profiles dp on dp.id = o.director_approved_by
  left join public.profiles sp on sp.id = o.senior_bypass_by
  left join public.profiles cp on cp.id = o.cancel_requested_by
  left join public.profiles xp on xp.id = o.cancelled_by
  where o.id = p_order
    and public.has_project_permission(o.project_id, 'procurement.order', 'read');
$$;

-- ── D. Direct asset placement/move is senior-only ────────────────────────────
-- Same as 0054 but the direct assign needs `inventory.asset:delete` (the senior
-- verb) rather than `update` — non-seniors use the request → accept transfer.
create or replace function public.assign_asset(p_asset uuid, p_project uuid, p_custodian uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.has_permission('inventory.asset', 'delete') then
    raise exception 'Only a senior may place or move an asset directly';
  end if;
  update public.inventory_assets
     set current_project_id = p_project,
         custodian_id = p_custodian,
         status = case when p_project is not null then 'in_use' else 'idle' end
   where id = p_asset;
  if not found then raise exception 'Asset not found'; end if;
end;
$$;
