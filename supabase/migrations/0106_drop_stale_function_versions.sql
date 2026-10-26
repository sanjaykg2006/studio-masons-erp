-- Studio-Masons ERP — close gaps found by the database checks: stale function
-- versions, callable approval helpers, and PO sign-off stamp order.
-- Run AFTER 0105_error_alerts.sql.
--
-- WHY
--   Postgres keeps a function per argument list, so when a later migration added
--   parameters with `create or replace`, the ORIGINAL version stayed callable
--   beside the new one. Found by the database checks (supabase/tests):
--
--   * record_receipt(uuid, date, text, jsonb) — the July original. It records a
--     receipt with no GRN and no invoice check, so the GRN rule (0103) could be
--     skipped by calling it directly. The app always calls the newer one.
--   * set_vendor_status(uuid, procurement_vendor_status) — the July original. It
--     approves a vendor outright, skipping the vendor's approval stage (0090) and
--     its "not your own" rule. The app's re-status buttons now reach the 0090
--     version, which does the same thing for an already-decided vendor and
--     refuses one still waiting on its stage.
--
--   supabase/tests/database/00_schema.test.sql now fails if any public function
--   ever has two versions again.

drop function if exists public.record_receipt(uuid, date, text, jsonb);
drop function if exists public.set_vendor_status(uuid, public.procurement_vendor_status);

-- ── Also: a PO's two sign-off stamps follow the stage order ─────────────────
-- apply_order_approval picked "first" and "last" approval by decision TIME; two
-- decisions with the same timestamp (as in one transaction) could stamp the
-- same person as both Finance and Director. The stage a decision was given at
-- is what those stamps mean, so order by that, time only as a tie-break.
create or replace function public.apply_order_approval(p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_first record; v_last record;
begin
  select d.decided_by, d.decided_at into v_first
  from public.approval_decisions d
  join public.approval_requests a on a.id = d.request_id
  where a.flow_id = 'order' and a.item_id = p_order and d.decision = 'approved'
  order by d.stage_index asc, d.decided_at asc limit 1;

  select d.decided_by, d.decided_at into v_last
  from public.approval_decisions d
  join public.approval_requests a on a.id = d.request_id
  where a.flow_id = 'order' and a.item_id = p_order and d.decision = 'approved'
  order by d.stage_index desc, d.decided_at desc limit 1;

  update public.procurement_orders
     set finance_reviewed_by  = coalesce(v_first.decided_by, auth.uid()),
         finance_reviewed_at  = coalesce(v_first.decided_at, now()),
         director_approved_by = coalesce(v_last.decided_by, auth.uid()),
         director_approved_at = coalesce(v_last.decided_at, now())
   where id = p_order and status in ('draft', 'amending');
end;
$$;


-- ── Approval helpers are the engine's alone ──────────────────────────────────
-- Each apply_* function is an approval's OUTCOME (approve the payment, publish
-- the brief…) with its own permission check deliberately removed, because only
-- approval_finish calls it, once the last stage has approved. But 0090/0091
-- never revoked them, so every signed-in user — and the public anon key — could
-- call one directly and approve a payment, invoice, advance, early retention,
-- intent or vendor with no approval at all. (Checked 2026-10-26: no live item
-- was ever approved outside a finished chain.) approval_finish runs as the
-- owner, so it is unaffected. 0102's budget helpers were already locked.
do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname like 'apply\_%'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end $$;
