-- 0097 — Nobody approves their own request, on every approval chain.
--
-- When the chains moved onto the approval engine (0089-0091) every stage
-- except Petty Cash's was seeded with block_own = false, to keep the old
-- behaviour. So the person who raised a PO, vendor, intent, brief, change
-- order, invoice, payment, advance or early retention release could approve
-- it themselves — an administrator included, since block_own is the one rule
-- the administrator backup can't pass. Turn it on everywhere; it can still be
-- switched off per stage on Access Control → Approval flows.

-- ── 1. Every stage ───────────────────────────────────────────────────────────
update public.approval_stages
   set block_own = true
 where block_own = false;

-- ── 2. Requests already waiting ──────────────────────────────────────────────
-- approval_start snapshots a flow's stages, so items raised before step 1
-- still carry block_own = false.
update public.approval_requests a
   set stages = (
     select jsonb_agg(e || jsonb_build_object('block_own', true) order by i)
     from jsonb_array_elements(a.stages) with ordinality as x(e, i)
   )
 where a.status = 'pending'
   and exists (
     select 1 from jsonb_array_elements(a.stages) e
     where coalesce((e ->> 'block_own')::boolean, true) = false
   );
