-- Studio-Masons ERP — publish RFI + task changes to the realtime stream
-- Run AFTER 0068_brief_template_read.sql.
--
-- WHY
--   The app is server-rendered: your own actions re-render the page, but until
--   now nothing told you about a change someone ELSE made. On a form that is
--   merely untidy; on an RFI — a question-and-answer conversation — it is wrong.
--   People were reloading the page by hand to see whether they had been
--   answered.
--
--   The app now listens for changes on these tables and re-renders when one
--   lands. Postgres only streams a table that is part of the `supabase_realtime`
--   publication, so this migration opts these three in. Everything else stays
--   off the stream.
--
-- WHAT THIS DOES NOT CHANGE
--   Row-Level Security still decides who is told what: the realtime server
--   evaluates the same policies per subscriber, so a person is only ever
--   notified about rows they were already allowed to read. No policy is
--   touched here, and no new data is exposed.
--
--   REPLICA IDENTITY FULL puts the whole previous row in the stream for updates
--   and deletes. That is what lets those policies be evaluated against the OLD
--   row too — without it, an update that moves a row out of someone's view
--   can't be filtered correctly. Cost is a slightly larger WAL record; these
--   three tables are small and low-traffic.

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  foreach t in array array['rfis', 'rfi_messages', 'tasks'] loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;

    execute format('alter table public.%I replica identity full', t);

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
