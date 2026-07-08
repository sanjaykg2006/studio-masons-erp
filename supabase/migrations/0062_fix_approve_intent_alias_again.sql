-- Studio-Masons ERP — Procurement: re-fix approve_intent record-alias clash
-- Run AFTER 0056_procurement_all_projects_and_verbs.sql.
--
-- BUG  Approving an intent again raised: record "il" is not assigned yet.
--   0049 fixed this exact clash, but 0056 rebuilt approve_intent and reintroduced
--   it: the FOR loop variable is named "il" and the table it reads from was ALSO
--   aliased "il", so inside the loop query "il.budget_line_id" resolved to the
--   (still unassigned) loop record instead of the table column, aborting approval.
--   This keeps 0056's logic verbatim and only re-aliases the loop's table to "l".

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
    select l.budget_line_id, l.qty_requested
    from public.procurement_intent_lines l
    where l.intent_id = p_intent and l.budget_line_id is not null
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
