-- Studio-Masons ERP — state the table grants the app relies on, instead of
-- inheriting them from Supabase's old defaults.
-- Run AFTER 0106_drop_stale_function_versions.sql.
--
-- WHY
--   Every table is guarded by row-level security, and the API roles (anon,
--   authenticated, service_role) were given the basic table privileges by
--   Supabase's DEFAULT privileges when this project was created. Newer Supabase
--   projects no longer grant those by default — a database rebuilt from these
--   migrations (a disaster-recovery restore, a new project, the local test
--   database) had NO select/insert/update/delete for those roles on any table,
--   so every screen and even the service-key server code would fail. Found by
--   the database checks (supabase/tests).
--
-- WHAT THIS DOES
--   Grants exactly what the live project already has (checked 2026-10-26), so on
--   live it changes nothing. Row-level security still decides which rows anyone
--   can see or change; these grants only let the request reach those rules.
--   Tables added by later migrations get the same through default privileges.

grant select, insert, update, delete on all tables in schema public
  to anon, authenticated, service_role;
grant usage, select, update on all sequences in schema public
  to anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant usage, select, update on sequences to anon, authenticated, service_role;
