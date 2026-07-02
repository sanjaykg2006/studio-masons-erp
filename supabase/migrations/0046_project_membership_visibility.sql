-- Studio-Masons ERP — Membership decides project visibility
-- Run AFTER 0045_intent_auto_amend.sql.
--
-- WHY
--   Holding `project:read` (or update/approve/delete) DEPARTMENT-WIDE means seeing
--   EVERY project — has_project_permission()'s global branch is has_permission(),
--   which isn't project-scoped. That let a plain "Projects → View" tick on People &
--   Access silently expose every project. The rule now: only `create` is a
--   department-wide project power; viewing/editing a project comes from project
--   MEMBERSHIP (or an explicit "all projects" senior switch / department-wide role).
--
-- WHAT THIS DOES
--   Removes the department-wide (per-person team) grants of `project` beyond
--   `create`, so no one keeps an accidental all-projects view. Membership grants
--   (project_members) and senior all-projects access are untouched; global/senior
--   roles set on central /access are untouched (that is where "sees all projects"
--   is meant to live). The UI already stops new such ticks (departmentActions).

delete from public.team_member_permissions
where resource = 'project'
  and action <> 'create';
