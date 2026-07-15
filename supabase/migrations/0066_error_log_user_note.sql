-- Studio-Masons ERP — Error Log: optional user note
-- Run AFTER 0065_error_log.sql.
--
-- Lets a person who hit a crash add a one-line "here's what I was doing", which
-- shows up next to the error for whoever reads the log. Written (like every
-- error_logs write) via the service_role key; no new end-user policy needed.

alter table public.error_logs
  add column if not exists user_note text;
