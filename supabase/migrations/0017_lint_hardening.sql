-- Studio-Masons ERP — Security-lint hardening
-- Run in the Supabase SQL Editor AFTER 0016_team_all_projects.sql.
--
-- Clears the warnings raised by the Supabase database linter. None of these were
-- exploitable (every SECURITY DEFINER function already self-guards on auth.uid()
-- and the per-role permission checks), but two are worth tidying:
--
--   1. set_updated_at() was the only function missing `set search_path`, leaving
--      a theoretical search_path-hijack on the trigger. Pin it to public.
--   2. Our RPCs are reachable by the anon (not-signed-in) role by default. They
--      reject anonymous callers internally, but there's no reason to expose them
--      at all. Postgres grants EXECUTE to the built-in PUBLIC group by default,
--      so anon gets access THROUGH that group — revoking from anon alone does
--      nothing. We revoke from PUBLIC (and anon), then grant EXECUTE back to the
--      authenticated and service_role roles so the app keeps working. This both
--      removes the attack surface and clears the 35 anon linter warnings.
--
-- NOTE: re-run section 2 after any future migration that adds new functions,
-- since fresh functions are granted to PUBLIC by default.

-- 1. Pin the trigger function's search_path ----------------------------------
alter function public.set_updated_at() set search_path = public;

-- 2. Stop exposing RPCs to anonymous (not-signed-in) callers -----------------
--    Revoke from PUBLIC + anon, then re-grant to the roles that need it.
revoke execute on all functions in schema public from public, anon;
grant  execute on all functions in schema public to authenticated, service_role;
