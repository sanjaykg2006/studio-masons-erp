-- 0096 — Discard an unreleased budget draft (a "Start budget" or "New version"
-- clicked by mistake could not be undone).
--
-- Only a DRAFT goes, and only by someone who could have made it: `create` for
-- the first version (as start_budget), `approve` for a later one (as
-- new_budget_version). Discarding a later draft leaves the released version
-- before it as the current budget.
--
-- Refused while anything points at the draft's lines: intent and PO lines
-- would block the delete anyway, and stock consumption would cascade away
-- silently. Released versions are never touched.

create or replace function public.discard_budget_draft(p_budget uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_project uuid;
  v_status  public.procurement_budget_status;
  v_version int;
begin
  select project_id, status, version_no into v_project, v_status, v_version
  from public.procurement_budgets where id = p_budget;
  if v_project is null then raise exception 'Budget not found'; end if;
  if v_status <> 'draft' then
    raise exception 'Only a draft can be discarded — a released version stays on record';
  end if;
  if not public.has_project_permission(
    v_project, 'procurement.budget',
    case when v_version = 1 then 'create' else 'approve' end::public.app_action
  ) then
    raise exception 'Not authorized to discard this budget draft';
  end if;

  if exists (
    select 1
    from public.procurement_budget_lines l
    join public.procurement_budget_packages p on p.id = l.package_id
    where p.budget_id = p_budget
      and (
        exists (select 1 from public.procurement_intent_lines il where il.budget_line_id = l.id)
        or exists (select 1 from public.procurement_order_lines ol where ol.budget_line_id = l.id)
        or exists (select 1 from public.inventory_consumption c where c.budget_line_id = l.id)
      )
  ) then
    raise exception 'This draft is already used by intents, purchase orders or stock records, so it can''t be discarded';
  end if;

  -- Packages and lines go with it (on delete cascade).
  delete from public.procurement_budgets where id = p_budget;
end;
$$;

revoke execute on function public.discard_budget_draft(uuid) from public, anon;
grant execute on function public.discard_budget_draft(uuid) to authenticated;
