-- Studio-Masons ERP — clear the ticks that approval stages replaced.
-- Run AFTER 0092_one_role_per_approval_stage.sql.
--
-- WHY
--   0092 moved every sign-off onto an approval stage that names one role, so a
--   handful of matrix ticks stopped meaning anything. A tick that grants nothing
--   is worse than no tick at all: it reads like it hands out an approval. These
--   are dropped from the registry, and the grants people already hold are
--   cleared here so no row is left ticked for a verb that does nothing.
--
--   Retired entirely — approving these is now an approval stage:
--     procurement.intent : approve      finance.payment : approve
--     finance.advance    : approve      project.brief   : approve
--     project.change     : approve      procurement.order : review
--
--   Petty Cash's "Billing check" and "Senior approval" rows went the same way.
--   Their only remaining effect was widening who could SEE claims, which is what
--   "See all claims" is for — so everyone holding one is given "See all claims"
--   first, then the two rows go. Nobody loses sight of anything: whoever a stage
--   is waiting on can already see that claim (pettycash_entries_select, 0089).
--
--   0092 read these same grants to work out each stage's role, and it runs
--   first, so nothing is lost by clearing them now.

-- ── 1. Petty Cash: fold the two step rows into "See all claims" ──────────────
insert into public.role_permissions (role_id, resource, action)
select distinct rp.role_id, 'pettycash.entry', 'read'::public.app_action
from public.role_permissions rp
where rp.resource in ('pettycash.billing', 'pettycash.senior')
  and rp.action = 'approve'
on conflict do nothing;

insert into public.team_member_permissions (department_id, user_id, resource, action)
select distinct tp.department_id, tp.user_id, 'pettycash.entry', 'read'::public.app_action
from public.team_member_permissions tp
where tp.resource in ('pettycash.billing', 'pettycash.senior')
  and tp.action = 'approve'
on conflict do nothing;

-- ── 2. Clear every grant on a verb that no longer does anything ──────────────
delete from public.role_permissions rp
where (rp.resource, rp.action) in (
        ('procurement.intent', 'approve'), ('finance.payment',   'approve'),
        ('finance.advance',    'approve'), ('project.brief',     'approve'),
        ('project.change',     'approve'), ('procurement.order', 'review')
      )
   or rp.resource in ('pettycash.billing', 'pettycash.senior');

delete from public.team_member_permissions tp
where (tp.resource, tp.action) in (
        ('procurement.intent', 'approve'), ('finance.payment',   'approve'),
        ('finance.advance',    'approve'), ('project.brief',     'approve'),
        ('project.change',     'approve'), ('procurement.order', 'review')
      )
   or tp.resource in ('pettycash.billing', 'pettycash.senior');

-- The two Petty Cash rows are gone as modules too, so no department keeps them
-- allotted and no "where is this set" choice is left pointing at nothing.
delete from public.department_modules where module_id in ('pettycash.billing', 'pettycash.senior');
delete from public.module_settings    where module_id in ('pettycash.billing', 'pettycash.senior');

-- ── 3. Who sees every Petty Cash claim ───────────────────────────────────────
-- "See all claims", or whoever pays them. Everyone still sees their own, and a
-- claim waiting on a stage is visible to whoever may give that stage.
create or replace function public.pettycash_sees_all()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.has_permission('pettycash.entry', 'read')
      or public.has_permission('pettycash.pay', 'issue');
$$;
