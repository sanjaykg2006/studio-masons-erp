-- Studio-Masons ERP — top job titles skip petty cash's senior approval.
-- Run AFTER 0083_job_title_order_and_senior_approval.sql.
--
-- WHAT CHANGES
--   A claim from the Managing Director or a Co-Founder has no one above it to
--   approve it, and does not need that step: after the Billing check it goes
--   straight to Accounts. Which job titles skip is a switch on each job title
--   in Access Control (roles.skips_senior_approval), seeded on for those two,
--   rather than a hard-coded list.
--
--   The Billing check still applies to everyone. Claims from these titles that
--   are already waiting for senior approval move on to Accounts.

alter table public.roles
  add column if not exists skips_senior_approval boolean not null default false;

update public.roles
   set skips_senior_approval = true
 where department_id is null and key in ('md', 'co_founder');

-- Whether a claimant's job title skips the senior-approval step.
create or replace function public.pettycash_skips_senior(p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((
    select r.skips_senior_approval
    from public.profiles p
    join public.roles r on r.id = p.role_id
    where p.id = p_user and r.department_id is null
  ), false);
$$;

-- Move a claim one step forward (0082), now skipping senior approval for the
-- job titles that don't need it.
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
       set status = case when public.pettycash_skips_senior(e.created_by)
                         then 'pending_accounts' else 'pending_md' end::public.pettycash_status,
           billing_by = auth.uid(), billing_at = now()
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

-- Claims already waiting on a step their claimant no longer needs.
update public.pettycash_entries
   set status = 'pending_accounts'
 where status = 'pending_md'
   and public.pettycash_skips_senior(created_by);
