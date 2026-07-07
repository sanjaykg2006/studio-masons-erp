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

Two surfaces edit the same `roles` / `role_permissions` model:

- **Central `/access` (admin, `access:*`)** — creates roles + departments, tags each
  role to a department, picks each department's modules, marks "general", invites
  people, and appoints each department's lead. Edits only the global/system roles'
  matrix.
- **`/team` Team Access (a department lead)** — for the roles under THEIR department
  only: ticks the permission matrix (their department's non-general modules), flags a
  role department-wide, and assigns people into those roles.

## Department leads

"Lead-ness" is membership in `public.department_leads`, not a matrix grant (mirrors
project membership). The boundary is enforced in the DB, in
`0010_department_leads.sql`:

- `is_department_lead(dept)` / `leads_any_department()` / `my_lead_departments()` —
  the lead-scoping primitives (parallel to `has_permission`).
- Lead branches are OR'd into the RLS on `roles` / `role_permissions` / `departments`
  / `department_modules` / `module_settings` reads, plus `role_permissions`
  insert/delete gated by `lead_can_grant(role, resource)`. A lead literally cannot
  touch another department, the global roles, or general modules.
- Role-scope and people-assignment go through SECURITY DEFINER RPCs
  (`set_role_department_wide`, `set_member_department_role`,
  `clear_member_department_role`) that re-check `is_department_lead`, so leads never
  get a broad write policy. The sidebar link shows via a `team.access:read` nav hint
  injected in `app/(app)/layout.tsx` when `leads_any_department()`.

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
