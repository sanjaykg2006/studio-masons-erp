-- Studio-Masons ERP — Procurement: route an approved intent into a PO amendment
-- Run AFTER 0044_procurement_amendments.sql.
--
-- WHAT THIS ADDS  (see docs/procurement-module-plan.md §4b — Path A)
--   When the Director APPROVES a purchase intent, any intent line whose budget
--   line ALREADY has a live purchase order folds into that PO as an amendment
--   instead of waiting for a fresh comparison:
--     * the PO line's quantity grows by the intent quantity (new total = current +
--       intent), the vendor stays fixed;
--     * the PO moves to 'amending' and its version bumps;
--     * the Director's approval of the intent carries as the amendment's Director
--       sign-off (they just approved it) — Finance still reviews, and an over-budget
--       result still needs the MD bypass before release;
--     * the amendment history records the originating intent for the trail.
--   Lines with no PO yet follow the normal comparison → award → PO path unchanged.

alter table public.procurement_order_amendments
  add column if not exists originating_intent_id uuid references public.procurement_intents (id);

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
    -- The live PO line for this budget line (a line is never split, so at most one
    -- relevant PO). Prefer one already amending, then issued, then closed; newest.
    select ol.id, o.id into v_ol, v_order
    from public.procurement_order_lines ol
    join public.procurement_orders o on o.id = ol.order_id
    where ol.budget_line_id = il.budget_line_id
      and o.project_id = v_project
      and o.status in ('issued', 'amending', 'closed')
    order by case o.status when 'amending' then 0 when 'issued' then 1 else 2 end,
             o.created_at desc
    limit 1;
    if v_ol is null then continue; end if;  -- no PO yet: normal comparison path

    if not (v_order = any (v_touched)) then
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
               director_approved_by = auth.uid(), director_approved_at = now(),
               senior_bypass_by = null, senior_bypass_at = null
         where id = v_order;
      else
        -- already mid-amendment: carry the Director sign-off from this approval
        update public.procurement_orders
           set director_approved_by = auth.uid(), director_approved_at = now()
         where id = v_order and director_approved_by is null;
      end if;
      v_touched := array_append(v_touched, v_order);
    end if;

    -- Grow the PO line to the new total (current + intent quantity).
    update public.procurement_order_lines
       set qty_ordered = qty_ordered + il.qty_requested
     where id = v_ol;
  end loop;

  foreach v_o in array v_touched loop
    perform public.recompute_order_over_budget(v_o);
  end loop;
end;
$$;
