-- Studio-Masons ERP — each petty-cash step belongs to the people who own it.
-- Run AFTER 0081_pettycash_due_date.sql.
--
-- WHAT WAS WRONG
--   The three steps (Billing check -> MD approval -> Accounts pays) were hidden
--   behind generic verbs on one row, "Petty Cash · Entries": Approve meant the
--   Billing step, Manage the MD step, Issue the payment. Nothing on screen said
--   so. The Director job title had been given Approve and Manage — two separate
--   steps — and Staff had Manage. Nothing stopped one person doing several steps
--   on the same claim, or approving their own. And no one in Finance could do
--   the Billing or Accounts step at all.
--
-- THE RULE FROM NOW ON
--   Logging a claim ...... anyone, no tick needed (unchanged).
--   Billing check ........ Billing department, People & Access
--                          ("Petty Cash · Billing check").
--   MD approval .......... job title, Access Control ("Petty Cash · MD approval").
--   Pay .................. Finance department, People & Access ("Petty Cash · Pay").
--   See all claims ....... job title ("Petty Cash · See all claims"), and anyone
--                          who does one of the steps.
--   Category list ........ Billing department, People & Access.
--
--   Only the owner of the step a claim is waiting on may approve or reject it:
--   a claim awaiting the Billing check can only be acted on by Billing, one
--   awaiting MD approval only by the MD, one awaiting payment only by Accounts.
--   Full-access administrators can act on any step, as a backup. Nobody —
--   administrators included — approves or rejects their own claim.
--
-- WHO IS AFFECTED ON THE DAY THIS RUNS
--   * The old step ticks are removed from every job title: Director loses Billing
--     and MD approval; Staff loses MD approval. Director keeps "See all claims".
--     Staff's View tick is removed too — it was never read before today, and
--     keeping it would now show every employee everyone's claims.
--   * A Billing department is created with no one in it. Until people are added
--     and ticked, only a full-access administrator can do the Billing check.

-- ── 1. The Billing department and where each step lives ──────────────────────
insert into public.departments (key, label, description, is_system)
select 'billing', 'Billing', 'Checks petty-cash claims and keeps the category list.', false
where not exists (select 1 from public.departments where key = 'billing');

-- Job-title (back-office) steps first, so the guard accepts later grants.
insert into public.module_settings (module_id, is_general) values
  ('pettycash.entry', true),      -- See all claims
  ('pettycash.md', true),         -- MD approval
  ('pettycash.billing', false),   -- Billing department
  ('pettycash.pay', false),       -- Finance department
  ('pettycash.category', false)   -- Billing department
on conflict (module_id) do update set is_general = excluded.is_general;

insert into public.department_modules (department_id, module_id)
select d.id, m.module_id
from public.departments d
join (values
  ('billing', 'pettycash.billing'),
  ('billing', 'pettycash.category'),
  ('finance', 'pettycash.pay')
) as m(dept_key, module_id) on m.dept_key = d.key
on conflict do nothing;

-- ── 2. Clear the old ticks ───────────────────────────────────────────────────
-- The old stage verbs on "Entries" mean nothing now; "read" stays as See all
-- claims except on Staff (see header). Categories leave job titles for Billing.
delete from public.role_permissions
where resource = 'pettycash.entry' and action in ('approve', 'manage', 'issue');

delete from public.role_permissions rp
using public.roles r
where r.id = rp.role_id and r.key = 'staff'
  and rp.resource = 'pettycash.entry';

delete from public.role_permissions rp
using public.roles r
where r.id = rp.role_id and r.department_id is null and not r.is_system
  and rp.resource = 'pettycash.category';

-- ── 3. Who may see everyone's claims ─────────────────────────────────────────
create or replace function public.pettycash_sees_all()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.has_permission('pettycash.entry', 'read')
      or public.has_permission('pettycash.billing', 'approve')
      or public.has_permission('pettycash.md', 'approve')
      or public.has_permission('pettycash.pay', 'issue');
$$;

drop policy if exists "pettycash_entries_select" on public.pettycash_entries;
create policy "pettycash_entries_select" on public.pettycash_entries
  for select using (created_by = auth.uid() or public.pettycash_sees_all());

-- ── 4. May the caller act on this claim's current step — and if not, why ─────
-- NULL = allowed. One rule for the buttons (list RPC) and for every action, so
-- they can never disagree.
create or replace function public.pettycash_block_reason(
  p_status     public.pettycash_status,
  p_created_by uuid
)
returns text
language sql stable security definer set search_path = public
as $$
  select case
    when p_status not in ('pending_billing', 'pending_md', 'pending_accounts')
      then 'This claim is already closed'
    when p_created_by = auth.uid()
      then 'You can''t approve or reject your own claim'
    when p_status = 'pending_billing' and not public.has_permission('pettycash.billing', 'approve')
      then 'This claim is waiting for the Billing check — only Billing can act on it'
    when p_status = 'pending_md' and not public.has_permission('pettycash.md', 'approve')
      then 'This claim is waiting for MD approval — only the MD can act on it'
    when p_status = 'pending_accounts' and not public.has_permission('pettycash.pay', 'issue')
      then 'This claim is waiting for payment — only Accounts can act on it'
    else null
  end;
$$;

-- Move a claim one step forward. The three public RPCs below wrap it.
create or replace function public.advance_pettycash(p_id uuid, p_from public.pettycash_status)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  e        public.pettycash_entries;
  v_reason text;
begin
  select * into e from public.pettycash_entries where id = p_id for update;
  if not found then raise exception 'Entry not found'; end if;
  if e.status <> p_from then
    raise exception 'This claim has already moved on — refresh the page';
  end if;
  v_reason := public.pettycash_block_reason(e.status, e.created_by);
  if v_reason is not null then raise exception '%', v_reason; end if;

  if p_from = 'pending_billing' then
    update public.pettycash_entries
       set status = 'pending_md', billing_by = auth.uid(), billing_at = now()
     where id = p_id;
  elsif p_from = 'pending_md' then
    update public.pettycash_entries
       set status = 'pending_accounts', md_by = auth.uid(), md_at = now()
     where id = p_id;
  else
    update public.pettycash_entries
       set status = 'paid', paid_by = auth.uid(), paid_at = now()
     where id = p_id;
  end if;
end;
$$;

revoke execute on function public.advance_pettycash(uuid, public.pettycash_status) from public, anon, authenticated;

create or replace function public.billing_approve_pettycash(p_id uuid)
returns void language sql security definer set search_path = public as $$
  select public.advance_pettycash(p_id, 'pending_billing');
$$;

create or replace function public.md_approve_pettycash(p_id uuid)
returns void language sql security definer set search_path = public as $$
  select public.advance_pettycash(p_id, 'pending_md');
$$;

create or replace function public.pay_pettycash(p_id uuid)
returns void language sql security definer set search_path = public as $$
  select public.advance_pettycash(p_id, 'pending_accounts');
$$;

-- Only the owner of the step a claim is waiting on may reject it.
create or replace function public.reject_pettycash(p_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  e        public.pettycash_entries;
  v_reason text;
begin
  select * into e from public.pettycash_entries where id = p_id for update;
  if not found then raise exception 'Entry not found'; end if;
  v_reason := public.pettycash_block_reason(e.status, e.created_by);
  if v_reason is not null then raise exception '%', v_reason; end if;
  update public.pettycash_entries
     set status = 'rejected', rejected_by = auth.uid(), rejected_at = now(),
         reject_reason = nullif(trim(p_reason), '')
   where id = p_id;
end;
$$;

-- ── 5. The list: same columns, flags from the one rule ───────────────────────
create or replace function public.list_pettycash_entries()
returns table (
  id uuid, created_by uuid, created_name text, project_id uuid, project_name text,
  category_name text, kind public.pettycash_kind, amount numeric, description text,
  spent_on date, file_path text, status public.pettycash_status,
  reject_reason text, created_at timestamptz, mine boolean,
  can_billing boolean, can_md boolean, can_pay boolean, can_reject boolean,
  due_date date, paid_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select e.id, e.created_by, coalesce(cp.full_name, cp.email), e.project_id, p.name,
         c.name, e.kind, e.amount, e.description, e.spent_on, e.file_path, e.status,
         e.reject_reason, e.created_at, e.created_by = auth.uid(),
         e.status = 'pending_billing'  and x.reason is null,
         e.status = 'pending_md'       and x.reason is null,
         e.status = 'pending_accounts' and x.reason is null,
         x.reason is null,
         e.due_date, e.paid_at
  from public.pettycash_entries e
  cross join lateral (
    select public.pettycash_block_reason(e.status, e.created_by) as reason
  ) x
  left join public.profiles cp on cp.id = e.created_by
  left join public.projects p on p.id = e.project_id
  left join public.pettycash_categories c on c.id = e.category_id
  where e.created_by = auth.uid() or public.pettycash_sees_all()
  order by e.created_at desc;
$$;
