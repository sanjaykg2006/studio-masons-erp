-- Studio-Masons ERP — Audit Log
-- Run AFTER 0002_rbac.sql.
--
-- An append-only record of WHO did WHAT and WHEN for sensitive actions (role and
-- permission changes, user invites/removals, role assignments). The app writes
-- entries with the service_role key (which bypasses RLS); end users can only
-- READ the log, and only if they hold the 'audit' permission. There are no
-- insert/update/delete policies for end users, so the trail cannot be forged or
-- erased through the app's normal (anon-key) clients — it is tamper-evident.

-- 1. The log table ------------------------------------------------------------
create table if not exists public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references auth.users (id) on delete set null, -- who did it
  actor_email text,                          -- email snapshot (survives deletion)
  action      text not null,                 -- machine code, e.g. 'user.invite'
  summary     text not null,                 -- human-readable description
  metadata    jsonb not null default '{}'::jsonb,  -- structured extra detail
  created_at  timestamptz not null default now()
);

-- Newest-first reads are the common case.
create index if not exists audit_log_created_at_idx
  on public.audit_log (created_at desc);

-- 2. Row-Level Security -------------------------------------------------------
alter table public.audit_log enable row level security;

-- Read-only, and only for holders of the 'audit' resource. Admins have the '*'
-- wildcard from 0002, so they can read it; grant other roles 'audit:read' in the
-- Access Control matrix. No INSERT/UPDATE/DELETE policies exist by design —
-- writes happen exclusively via the service_role key in server actions.
drop policy if exists "audit_read" on public.audit_log;
create policy "audit_read" on public.audit_log
  for select using (has_permission('audit', 'read'));
