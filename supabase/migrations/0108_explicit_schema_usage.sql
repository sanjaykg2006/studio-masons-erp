-- Studio-Masons ERP — state the schema access the API roles rely on.
-- Run AFTER 0107_explicit_table_grants.sql.
--
-- 0107 wrote down the table grants; this writes down the one above them. A
-- database reset (`supabase db reset --linked`, as when the test ERP was built
-- from these migrations on 2026-10-26) recreates the public schema without the
-- USAGE grant the API roles had from the project's defaults, so even the
-- service key got "permission denied for schema public". Live already has it,
-- so this changes nothing there.

grant usage on schema public to anon, authenticated, service_role;
