-- 0098 — A private staging bucket for large uploads.
--
-- Vercel refuses any request body over ~4.5 MB before the app sees it, so a
-- file sent inside a server action crashed or hung once it was bigger than
-- that. The browser now puts the file here first with a one-time signed
-- upload ticket, and the server action moves it to its real bucket after its
-- usual checks (src/core/uploads). Only the service role reads or writes it —
-- no policies, so nothing else can.
insert into storage.buckets (id, name, public)
values ('upload-staging', 'upload-staging', false)
on conflict (id) do nothing;
