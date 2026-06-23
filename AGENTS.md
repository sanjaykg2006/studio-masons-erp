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