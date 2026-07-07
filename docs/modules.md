# Creating Modules

Feature modules are where the ERP grows. Each lives in `src/modules/<feature>/` and
exports a `ModuleDefinition`. Use `src/modules/dashboard/` as the reference.

## Steps

1. Create `src/modules/<feature>/index.ts` exporting a `ModuleDefinition`.
2. Create the App Router page `src/app/(app)/<feature>/page.tsx` (guard it with
   `requireUser()`).
3. Register the module in the `modules` array in `src/core/modules/registry.ts`.
   The sidebar nav updates automatically.
4. Add permissions if the module has its own data (see below).

## Permission-aware Modules

The access matrix shows a checkbox for every `(module, action)` a module declares.
**A checkbox does nothing on its own** — it just records a grant. The module must
actually enforce it, or a ticked box is cosmetic. `src/modules/access/` is the
worked reference.

Do all of this for a new data module (`<id>` = the module id = the permission
`resource`):

1. **Declare the verbs.** Set `actions: [...]` in the `ModuleDefinition` so the
   matrix renders those columns. Declaring a `read` action automatically hides the
   sidebar link from any role without `<id>:read`.
2. **Enforce in the DB — the real boundary.** In the module's migration, enable RLS
   and add policies that call `has_permission('<id>', '<action>')`. See
   [`migrations.md`](migrations.md).
3. **Guard pages and server actions.** Pages: `await requirePermission('<id>','read')`.
   Server actions: `const denied = await authorize('<id>','<action>'); if (denied) return denied;`
   See [`permissions.md`](permissions.md).
4. **Gate the UI.** Wrap controls in `<Can resource="<id>" action="...">` or check
   `usePermissions()` so users don't see actions they can't use (cosmetic only).
5. **Departments.** New non-general modules are department-scoped: an admin must add
   the module to a department under `/access` before its roles can be granted it.

Checklist before calling a module "done": actions declared · RLS policies on every
table · `requirePermission` on page + each action · `<Can>` / `usePermissions` in
the UI · migration applied (`npm run db:push`).

### Modules with several gated resources

A module that gates more than one object (e.g. a project + its briefs + templates +
membership) sets `resources: [...]` on its `ModuleDefinition` instead of a single
`actions`. Each entry is its own permission `resource` and its own matrix row, under
one sidebar item. `src/modules/design/` is the reference. Sub-resources are dotted,
e.g. `design.project`.
