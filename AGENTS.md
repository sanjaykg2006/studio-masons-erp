# AGENTS.md

## Rules

- Read relevant files before editing.
- Make minimal changes.
- Reuse existing code.
- Avoid duplication.
- Use TypeScript strictly.
- Avoid `any`.
- Use functional React components.
- Follow Next.js App Router conventions.
- Use Tailwind for styling.
- Remove unused imports and dead code.
- Do not modify unrelated files.

## Before Finishing

- Run lint.
- Check TypeScript errors.
- Verify build succeeds.
- Summarize changes made.

## Architecture (Studio-Masons ERP)

Strict layering — each layer has one job, never mix them:

- `src/app/` — **routing only.** Thin pages/layouts that read data and delegate
  to modules/components. Route groups: `(auth)` = public, `(app)` = protected.
- `src/core/` — **shared, cross-cutting infrastructure.** Stable, reusable:
  - `core/config/env.ts` — zod-validated PUBLIC env (`NEXT_PUBLIC_*`). Server-only
    secrets go in `core/config/server-env.ts` (lazy, `server-only`).
  - `core/supabase/{client,server,middleware}.ts` — the three request clients.
    `core/supabase/admin.ts` — privileged service-role client; bypasses RLS, use
    only inside permission-gated server actions.
  - `core/auth/` — `actions.ts` (server actions), `get-user.ts` (`getUser`/`requireUser` guards), `types.ts` (the `AuthProvider` abstraction).
  - `core/modules/registry.ts` — the feature registry + `ModuleDefinition` type.
- `src/modules/<feature>/` — **feature modules** (where the ERP grows). Each has
  an `index.ts` exporting a `ModuleDefinition` and a `components/` folder.
- `src/components/ui/` — shadcn primitives. `src/components/layout/` — app shell.
- `src/lib/` — generic helpers (`cn`).

### Auth flow
- `middleware.ts` refreshes the session and guards `(app)` routes (first line).
- `app/(app)/layout.tsx` calls `requireUser()` (server-side guard, second line).
- All auth goes through `core/auth`. Adding Microsoft Entra ID SSO = enable the
  Azure provider in Supabase + add a `signInWithOAuth("azure")` button. No refactor.

### How to add a feature module (the extension point)
1. Create `src/modules/<feature>/index.ts` exporting a `ModuleDefinition`.
2. Create the route `src/app/(app)/<feature>/page.tsx` (guard with `requireUser()`).
3. Add the module to the `modules` array in `src/core/modules/registry.ts`.
The sidebar nav updates automatically. Use `src/modules/dashboard/` as the template.

### Make the module permission-aware (REQUIRED if it has its own data)
The access-control matrix shows a checkbox for every `(module, action)` a module
declares in `ModuleDefinition.actions`. **A checkbox does nothing on its own** — it
just records a grant. The module must actually enforce it. Without these steps a
ticked box is cosmetic. `src/modules/access/` is the worked reference.

Do all of this for a new data module (`<id>` = the module id = the permission
`resource`; pick from `create | read | update | delete`):

1. **Declare the verbs.** Set `actions: [...]` in the `ModuleDefinition` so the
   matrix renders those columns. Declaring a `read` action automatically hides the
   sidebar link from any role without `<id>:read` — no `requires` needed. Set
   `requires` only to gate by a *different* resource/action than `<id>:read`.
2. **Enforce in the DB — this is the real boundary.** In the module's migration,
   `enable row level security` on each table and add policies that call
   `has_permission('<id>', '<action>')`:
   - `for select using (has_permission('<id>','read'))`
   - `for insert with check (has_permission('<id>','create'))`
   - `for update using (...'update') with check (...'update')`
   - `for delete using (has_permission('<id>','delete'))`
   RLS is what stops a crafted request; never rely on app guards alone.
3. **Guard pages/server actions.** Pages: start with
   `await requirePermission('<id>','read')` — redirects to `/forbidden` with a
   clear message. Server actions: `const denied = await authorize('<id>','<action>'); if (denied) return denied;`
   — returns a readable "no permission" ActionResult the UI shows inline (never
   redirect mid-click). Convenience layer; RLS is the real boundary.
4. **Gate the UI.** Wrap action buttons in `<Can resource="<id>" action="...">` or
   check `usePermissions()` so users don't see controls they can't use (cosmetic).
5. **Departments.** New non-general modules are department-scoped: an admin must add
   the module to a department under `/access` before that department's roles can be
   granted it. Mark it general there only if every role should get it.

Checklist before calling a module "done": actions declared ✓ · RLS policies on
every table ✓ · `requirePermission` on page + each action ✓ · `<Can>`/`usePermissions`
in the UI ✓ · migration applied (`npm run db:push`) ✓.