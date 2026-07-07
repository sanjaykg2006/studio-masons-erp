# Project-scoped Access

When access depends on which project a user belongs to (not just their global role),
gate with the project-aware layer instead of the global one in
[`permissions.md`](permissions.md). Nothing else belongs in this document.

## `has_project_permission`

The DB primitive. RLS policies call
`has_project_permission(project_id, resource, action)` — true for a department-wide
global role OR a per-project membership role.

## `requireProjectPermission`

The page guard: `await requireProjectPermission(projectId, '<id>', '<action>')`.
Put it as the first line of a project-scoped page.

## `authorizeProject`

The server-action guard:

```
const denied = await authorizeProject(projectId, '<id>', '<action>');
if (denied) return denied;
```

## `getProjectPermissions`

For UI gating: load `getProjectPermissions(projectId)` and pass the keys down so
controls hide when the user lacks the per-project grant.

---

Register the module's sub-resources to a department (so the 0004 guard permits
granting them) — see migration 0006 for the worked example.
