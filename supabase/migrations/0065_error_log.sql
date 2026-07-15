-- Studio-Masons ERP — Error Log
-- Run AFTER 0003_audit.sql (mirrors its tamper-evident design).
--
-- A technical record of things that BROKE — page crashes on the website and
-- unexpected failures in the backend — so a developer / IT person can read a
-- clear message (what, when, who, which screen) without digging through the
-- hosting provider's raw logs.
--
-- Like the audit log: the app writes rows with the service_role key (bypasses
-- RLS); end users can only READ, and only if they hold the 'errorlog'
-- permission (top admins have it via their '*' wildcard from 0002). There are
-- NO insert/update/delete policies for end users, so the log can't be forged or
-- wiped through the normal (anon-key) client.

-- 1. The log table ------------------------------------------------------------
create table if not exists public.error_logs (
  id           uuid primary key default gen_random_uuid(),
  occurred_at  timestamptz not null default now(),
  source       text not null,                 -- 'client' (page crash) | 'server' (backend)
  context      text not null,                 -- where it happened, e.g. 'app', 'finance action'
  message      text not null,                 -- the human-readable error message
  digest       text,                          -- Next.js error id (matches what the user is shown)
  detail       text,                          -- stack trace / extra technical detail
  path         text,                          -- URL/route where it happened
  user_id      uuid references auth.users (id) on delete set null,
  user_email   text                           -- email snapshot (survives deletion)
);

-- Newest-first reads are the common case.
create index if not exists error_logs_occurred_at_idx
  on public.error_logs (occurred_at desc);

-- 2. Row-Level Security -------------------------------------------------------
alter table public.error_logs enable row level security;

-- Read-only, and only for holders of the 'errorlog' resource. Admins have the
-- '*' wildcard, so they can read it; grant other roles 'errorlog:read' in the
-- Access Control matrix if you want a specific IT person to see it. No
-- INSERT/UPDATE/DELETE policies exist by design — writes happen exclusively via
-- the service_role key in server code.
drop policy if exists "error_logs_read" on public.error_logs;
create policy "error_logs_read" on public.error_logs
  for select using (has_permission('errorlog', 'read'));
