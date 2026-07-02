-- Studio-Masons ERP — Activity Log: department dimension + actor name
-- Run AFTER 0047_tasks_lead_only.sql.
--
-- WHY
--   The Activity Log is a single company-wide stream showing actor emails. Add:
--     * department_id — so it can be viewed per department (NULL = company-wide
--       actions like role/user changes); and
--     * actor_name    — a snapshot of the actor's name so the log reads by person,
--       not email (email stays as the fallback for older rows).
--   Nothing is deleted — the log stays append-only and complete; the app just gains
--   a filter + full pagination. logAudit() fills these in going forward.

alter table public.audit_log
  add column if not exists department_id uuid references public.departments (id) on delete set null,
  add column if not exists actor_name text;

create index if not exists audit_log_department_idx
  on public.audit_log (department_id, created_at desc);
