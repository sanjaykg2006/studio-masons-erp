-- Studio-Masons ERP — job titles get an order; petty cash's second step becomes
-- "senior approval" by someone above the claimant.
-- Run AFTER 0082_pettycash_step_owners.sql.
--
-- WHAT CHANGES
--   1. Job titles are ranked (1 = most senior), like each department's role
--      ladder. Access Control gains up/down arrows (move_job_title). Starting
--      order: Administrator, Managing Director, Co-Founder, Director, any other
--      titles by name, then Staff — rearrange it on screen.
--
--   2. Petty cash's second step was "MD approval": one tick, whoever held it.
--      The rule is now: a claim from someone below Director is approved by a
--      Director; a claim from a Director or above needs the Managing Director.
--      Generalised, the approver must hold "Petty Cash · Senior approval" AND a
--      job title ABOVE the claimant's. So with MD > Director > Staff:
--        Staff claim ...... a Director (or the MD) may approve;
--        Director claim ... only the MD may approve.
--      Full-access administrators are exempt from the "above" rule, as the
--      backup that covers the top of the order (the MD's own claim has nobody
--      above it). Nobody approves or rejects their own claim.
--
--      The tick is renamed pettycash.md -> pettycash.senior and every existing
--      grant carries over. The status value stays 'pending_md' (its label on
--      screen becomes "Awaiting senior approval").
--
--   The Managing Director job title itself is unchanged (full access). Nobody
--   holds it yet — assign it in Access Control.

-- ── 1. Job-title order ───────────────────────────────────────────────────────
with ordered as (
  select id,
         row_number() over (
           order by case key
                      when 'admin'      then 1
                      when 'md'         then 2
                      when 'co_founder' then 3
                      when 'director'   then 4
                      when 'staff'      then 99
                      else 50
                    end,
                    label
         ) as rn
  from public.roles
  where department_id is null
)
update public.roles r set rank = o.rn from ordered o where o.id = r.id;

create or replace function public.move_job_title(p_role uuid, p_up boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_rank int; v_other uuid; v_other_rank int;
begin
  if not public.has_permission('access', 'update') then
    raise exception 'Not authorized to reorder job titles';
  end if;
  select rank into v_rank from public.roles where id = p_role and department_id is null;
  if v_rank is null then raise exception 'Unknown job title'; end if;

  if p_up then
    select id, rank into v_other, v_other_rank from public.roles
    where department_id is null and rank < v_rank order by rank desc limit 1;
  else
    select id, rank into v_other, v_other_rank from public.roles
    where department_id is null and rank > v_rank order by rank asc limit 1;
  end if;
  if v_other is null then return; end if;

  update public.roles set rank = v_other_rank where id = p_role;
  update public.roles set rank = v_rank       where id = v_other;
end;
$$;

-- A person's place in the order (1 = most senior). No job title = most junior.
create or replace function public.job_title_rank(p_user uuid)
returns integer
language sql stable security definer set search_path = public
as $$
  select coalesce((
    select r.rank
    from public.profiles p
    join public.roles r on r.id = p.role_id
    where p.id = p_user and r.department_id is null
  ), 2147483647);
$$;

-- Whether the caller's job title has full access ('*').
create or replace function public.has_full_access()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    join public.role_permissions rp on rp.role_id = p.role_id
    where p.id = auth.uid() and rp.resource = '*'
  );
$$;

-- ── 2. MD approval -> Senior approval ────────────────────────────────────────
insert into public.module_settings (module_id, is_general)
values ('pettycash.senior', true)
on conflict (module_id) do update set is_general = true;

update public.role_permissions set resource = 'pettycash.senior'
where resource = 'pettycash.md';

delete from public.module_settings where module_id = 'pettycash.md';

create or replace function public.pettycash_sees_all()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.has_permission('pettycash.entry', 'read')
      or public.has_permission('pettycash.billing', 'approve')
      or public.has_permission('pettycash.senior', 'approve')
      or public.has_permission('pettycash.pay', 'issue');
$$;

-- The one rule for buttons and actions (0082), with the "above the claimant"
-- check on the second step.
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
    when p_status = 'pending_md' and not public.has_permission('pettycash.senior', 'approve')
      then 'This claim is waiting for senior approval — only someone with Senior approval can act on it'
    when p_status = 'pending_md'
         and not public.has_full_access()
         and public.job_title_rank(auth.uid()) >= public.job_title_rank(p_created_by)
      then 'This claim needs approval from someone senior to '
           || coalesce((
                select r.label from public.profiles p
                join public.roles r on r.id = p.role_id
                where p.id = p_created_by and r.department_id is null
              ), 'the claimant')
    when p_status = 'pending_accounts' and not public.has_permission('pettycash.pay', 'issue')
      then 'This claim is waiting for payment — only Accounts can act on it'
    else null
  end;
$$;
