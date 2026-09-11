# Permissions / RBAC

Everything permission-related lives here. How a user *authenticates* is in
[`auth.md`](auth.md); permissions that depend on which project a user belongs to are
in [`project-access.md`](project-access.md).

## Access verbs

Eight verbs exist:

- The CRUD core — `create` / `read` / `update` / `delete` (shown in the UI as
  Create / View / Edit / Delete).
- The governance verbs — `review` / `approve` / `issue` / `manage`, used by approval
  workflows.

They're listed in `ACTIONS` (`core/rbac/types.ts`) and the DB `app_action` enum —
keep the two in sync.

## Resources

The `resource` is normally the module id. A module that gates several objects sets
`resources: [...]` on its `ModuleDefinition`, one matrix row each, with dotted names
(e.g. `design.project`). See [`modules.md`](modules.md).

## Role permissions

Roles and grants share one model: `roles` + `role_permissions`. A grant is a
`(resource, action)` pair recorded against a role. The grant alone does nothing —
enforcement happens in the DB and in the guards below.

## General modules

New non-general modules are department-scoped: an admin must add the module to a
department before that department's roles can be granted it. A module marked
**general** is available to every role without that step.

## Access matrix

Three screens hand out access. **Every resource has exactly one home**, declared by
its flags in the module registry (`registry.test.ts` fails if a resource has two):

| Screen | Who edits it | What it grants | Registry flag |
|---|---|---|---|
| Access Control `/access` (also Departments → IT) | Anyone holding Access Control — itself an IT People & Access tick that only a full-access Administrator can hand out (0085) | Job titles → company-wide screens (general modules, incl. Petty Cash). Also creates departments, allots their modules, appoints leads, invites people. | neither |
| People & Access `/departments/<id>/people` | The lead, or anyone given People & Access | Per person, the department's own work: Tasks, Settings, People & Access (`everyDepartment`, built into every department) plus the tools allotted to it (Design's template library, vendor list, company assets, billing branches). | `departmentLevel` |
| Settings → Project roles `/departments/<id>/settings` (Design: `/design/settings`) | The lead, or anyone given Settings | Per project role, what it can do on a project. Two rows aren't tied to one project and apply wherever the role is held (any project, or every project): Projects · Create ("may start new projects") and Project · Templates (the shared library + default checklist). The app checks these with `canAnywhere` / `requireAnywhere` / `authorizeAnywhere`; the DB with `has_permission_anywhere()`. | `projectRole` |

## Department leads

"Lead-ness" is membership in `public.department_leads`, not a matrix grant (mirrors
project membership). A lead holds Tasks, Settings and People & Access automatically
and can tick them for others on People & Access; only the lead (or HR) can hand out
Settings or People & Access, so a delegate cannot pass on more than they were given.

The DB primitives (`0010_department_leads.sql`, widened in
`0078_one_home_per_permission.sql`):

- `is_department_lead(dept)` / `leads_any_department()` — lead-ness itself.
- `has_team_permission(dept, resource, action)` — one person's tick in ONE
  department. `has_permission()` unions team grants across every department, so
  department-scoped abilities must use this instead.
- `can_manage_team(dept)` (People & Access), `can_manage_department_roles(dept)`
  (Settings), `can_create_task(dept)` / `can_manage_department_tasks(dept)` (Tasks) —
  each is lead OR HR OR the matching tick.
- `manages_department(dept)` / `manages_any_department()` — who may READ a
  department's roles, modules, team and sub-teams; OR'd into those tables' RLS.
- `can_create_project()` — job title, or a project role with Projects · Create held
  on any project or on every project. Used by the `projects` insert policy.
- Writes go through SECURITY DEFINER RPCs that re-check the rule
  (`set_team_member_permission`, `set_department_role_permission`, …), so nobody
  gets a broad write policy.

## Enforcement helpers

- **`requirePermission('<id>','<action>')`** — page guard. Redirects to `/forbidden`
  with a clear message. Put it as the first line of the page.
- **`authorize('<id>','<action>')`** — server-action guard. Returns a readable
  "no permission" `ActionResult` the UI shows inline (never redirect mid-click):
  `const denied = await authorize('<id>','<action>'); if (denied) return denied;`
- **`<Can resource="<id>" action="...">`** / **`usePermissions()`** — UI gating so
  users don't see controls they can't use. Cosmetic only.

These are a convenience layer. **RLS in the database is the real boundary** — never
rely on app guards alone. See [`migrations.md`](migrations.md).
