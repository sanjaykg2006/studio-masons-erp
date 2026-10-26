-- Studio-Masons ERP — tell someone when something breaks.
-- Run AFTER 0104_waiting_approvals_follow_edits.sql.
--
-- WHY
--   Crashes were recorded in the Error Log, but nobody was told: problems were
--   found by users. This adds the database side of email alerts:
--     * error_logs.alerted_at — which errors have already been emailed, so
--       crashes close together go out as ONE email, at most every 15 minutes.
--     * alert_recipients() — the IT department (members + leads); while it has
--       nobody active, the full-access administrators.
--     * Two scheduled jobs (pg_cron + pg_net) that call the website:
--         every 5 minutes  /api/cron/alerts  — send crash emails still waiting
--                                               out their 15-minute gap
--         09:00 IST daily  /api/cron/daily   — email the stuck approvals
--       The site URL and the shared secret come from Vault (alerts_site_url,
--       alerts_cron_secret), set outside this file so the secret never lands in
--       git. Until both exist the jobs do nothing.
--   "Site or database down" is watched from OUTSIDE (UptimeRobot calling
--   /api/health): when the database is down, nothing in here can run.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- ── 1. Which errors were emailed ─────────────────────────────────────────────
alter table public.error_logs add column if not exists alerted_at timestamptz;

-- Everything logged before alerts existed counts as already seen.
update public.error_logs set alerted_at = occurred_at where alerted_at is null;

create index if not exists error_logs_unalerted_idx
  on public.error_logs (occurred_at) where alerted_at is null;

-- ── 2. Who gets alerts ───────────────────────────────────────────────────────
create or replace function public.alert_recipients()
returns table (email text, name text, via text)
language sql stable security definer set search_path = public
as $$
  with it as (
    select distinct p.email, coalesce(p.full_name, p.email) as name
    from public.departments d
    join (
      select department_id, user_id from public.team_members
      union
      select department_id, user_id from public.department_leads
    ) m on m.department_id = d.id
    join public.profiles p on p.id = m.user_id
    where d.key = 'it' and p.deactivated_at is null and p.email is not null
  ),
  admins as (
    select distinct p.email, coalesce(p.full_name, p.email) as name
    from public.profiles p
    join public.role_permissions rp on rp.role_id = p.role_id and rp.resource = '*'
    where p.deactivated_at is null and p.email is not null
  )
  select email, name, 'it' from it
  union all
  select email, name, 'admins' from admins where not exists (select 1 from it);
$$;

revoke execute on function public.alert_recipients() from public, anon, authenticated;

-- What the Error Log page shows: who alerts go to. Readable by whoever can
-- read the log.
create or replace function public.my_alert_recipients()
returns table (name text, via text)
language sql stable security definer set search_path = public
as $$
  select r.name, r.via from public.alert_recipients() r
  where public.has_permission('errorlog', 'read');
$$;

grant execute on function public.my_alert_recipients() to authenticated;

-- ── 3. Claim the errors for the next email ───────────────────────────────────
-- When each kind of alert last went out. No policies: only the service key and
-- the functions below touch it.
create table if not exists public.alert_state (
  key     text primary key,
  sent_at timestamptz not null
);
alter table public.alert_state enable row level security;

-- Returns (and stamps) every error not yet emailed — unless an email went out
-- within the last p_gap_minutes, in which case it returns nothing and the
-- 5-minute job picks them up once the gap has passed. The advisory lock stops
-- two crashes at the same moment from sending two emails.
create or replace function public.claim_error_alert_batch(p_gap_minutes integer default 15)
returns setof public.error_logs
language plpgsql security definer set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtext('error_alert_batch'));
  if exists (
    select 1 from public.alert_state
    where key = 'errors' and sent_at > now() - make_interval(mins => p_gap_minutes)
  ) then
    return;
  end if;
  return query
    update public.error_logs set alerted_at = now()
    where alerted_at is null
    returning *;
  if found then
    insert into public.alert_state (key, sent_at) values ('errors', now())
    on conflict (key) do update set sent_at = excluded.sent_at;
  end if;
end;
$$;

revoke execute on function public.claim_error_alert_batch(integer) from public, anon, authenticated;

-- ── 4. The daily email reads the waiting approvals ───────────────────────────
-- Same as 0104, except the service key may read it too.
create or replace function public.list_waiting_approvals()
returns table (
  id uuid, flow_id text, flow_label text, item_id uuid,
  project_id uuid, project_label text, item_ref text, amount numeric,
  requester_name text, raised_at timestamptz, waiting_since timestamptz,
  stage_label text, stage_no integer, stage_count integer, approver_label text,
  can_approve text[], admin_backup text[]
)
language sql stable security definer set search_path = public
as $$
  with w as (
    select a.*, a.stages -> a.current as s,
           nullif(a.stages -> a.current ->> 'role_id', '')::uuid as role_id,
           coalesce((a.stages -> a.current ->> 'block_own')::boolean, true) as block_own
    from public.approval_requests a
    where a.status = 'pending'
      -- The daily stuck-approvals email reads it with the service key.
      and (public.has_permission('access', 'read') or auth.role() = 'service_role')
  ),
  -- People who already gave a stage of the item, or raised it when it blocks
  -- that: they can't give this one, administrators included.
  barred as (
    select w.id as request_id, d.decided_by as user_id
    from w join public.approval_decisions d on d.request_id = w.id
    union
    select w.id, w.requester from w where w.block_own and w.requester is not null
  ),
  eligible as (
    select w.id as request_id, p.id as user_id, coalesce(p.full_name, p.email) as name
    from w
    join public.profiles p on p.deactivated_at is null
    where case
      when w.s ->> 'approver' = 'dept_lead' then exists (
        select 1 from public.department_leads dl
        where dl.user_id = p.id
          and (
            dl.department_id in (select tm.department_id from public.team_members tm where tm.user_id = w.requester)
            or dl.department_id = (select pr.department_id from public.projects pr where pr.id = w.project_id)
          )
      )
      when (select r.department_id from public.roles r where r.id = w.role_id) is null then
        p.role_id = w.role_id
      else
        w.project_id is not null and (
          exists (
            select 1 from public.project_members m
            where m.project_id = w.project_id and m.user_id = p.id and m.role_id = w.role_id
          )
          or exists (
            select 1 from public.team_members tm
            where tm.user_id = p.id and tm.all_projects and tm.all_projects_role_id = w.role_id
          )
        )
    end
  ),
  admins as (
    select distinct p.id as user_id, coalesce(p.full_name, p.email) as name
    from public.profiles p
    join public.role_permissions rp on rp.role_id = p.role_id and rp.resource = '*'
    where p.deactivated_at is null
  )
  select
    w.id, w.flow_id, f.label, w.item_id,
    w.project_id, coalesce(pr.code, pr.name),
    case w.flow_id
      when 'order'   then (select o.po_number from public.procurement_orders o where o.id = w.item_id)
      when 'advance' then (select o.po_number from public.procurement_orders o where o.id = w.item_id)
      when 'vendor'  then (select v.name from public.procurement_vendors v where v.id = w.item_id)
      when 'invoice' then (select i.invoice_no from public.finance_invoices i where i.id = w.item_id)
      when 'payment' then (
        select i.invoice_no from public.finance_payment_requests pq
        join public.finance_invoices i on i.id = pq.invoice_id where pq.id = w.item_id)
      when 'retention_early' then (
        select i.invoice_no from public.finance_retention rt
        join public.finance_invoices i on i.id = rt.invoice_id where rt.id = w.item_id)
      when 'budget'  then (select 'Version ' || b.version_no from public.procurement_budgets b where b.id = w.item_id)
      when 'pettycash' then (select e.description from public.pettycash_entries e where e.id = w.item_id)
    end,
    w.amount,
    coalesce(rq.full_name, rq.email), w.created_at,
    coalesce((select max(d.decided_at) from public.approval_decisions d where d.request_id = w.id), w.created_at),
    w.s ->> 'label', w.current + 1, jsonb_array_length(w.stages),
    case
      when w.s ->> 'approver' = 'dept_lead' then 'Requester''s department lead'
      else (
        select case when ro.department_id is null then ro.label
                    else coalesce(dp.label || '''s ', '') || ro.label end
        from public.roles ro left join public.departments dp on dp.id = ro.department_id
        where ro.id = w.role_id
      )
    end,
    coalesce((
      select array_agg(e.name order by e.name) from eligible e
      where e.request_id = w.id
        and not exists (select 1 from barred b where b.request_id = w.id and b.user_id = e.user_id)
    ), '{}'),
    coalesce((
      select array_agg(ad.name order by ad.name) from admins ad
      where not exists (select 1 from barred b where b.request_id = w.id and b.user_id = ad.user_id)
    ), '{}')
  from w
  join public.approval_flows f on f.id = w.flow_id
  left join public.projects pr on pr.id = w.project_id
  left join public.profiles rq on rq.id = w.requester
  order by w.created_at;
$$;

grant execute on function public.list_waiting_approvals() to authenticated;

-- ── 5. Scheduled jobs ────────────────────────────────────────────────────────
-- Each posts to the website with the shared secret; nothing happens until both
-- Vault secrets are set. The 5-minute job only calls out when an error is
-- actually waiting to be emailed.
select cron.schedule(
  'erp-error-alerts',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'alerts_site_url') || '/api/cron/alerts',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'alerts_cron_secret')),
    body    := '{}'::jsonb
  )
  where exists (select 1 from vault.decrypted_secrets where name = 'alerts_cron_secret')
    and exists (select 1 from vault.decrypted_secrets where name = 'alerts_site_url')
    and exists (select 1 from public.error_logs where alerted_at is null);
  $job$
);

-- 03:30 UTC = 09:00 IST.
select cron.schedule(
  'erp-daily-summary',
  '30 3 * * *',
  $job$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'alerts_site_url') || '/api/cron/daily',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'alerts_cron_secret')),
    body    := '{}'::jsonb
  )
  where exists (select 1 from vault.decrypted_secrets where name = 'alerts_cron_secret')
    and exists (select 1 from vault.decrypted_secrets where name = 'alerts_site_url');
  $job$
);
