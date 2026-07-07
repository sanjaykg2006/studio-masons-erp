# Architecture

Studio-Masons ERP. Strict layering — each layer has one job, never mix them.

## Layers

- `src/app/` — **routing only.** Thin pages/layouts that read data and delegate to
  modules/components. Route groups: `(auth)` = public, `(app)` = protected.
- `src/core/` — **shared, cross-cutting infrastructure.** Stable and reusable:
  - `core/config/` — environment (see [Environment](#environment)).
  - `core/supabase/{client,server,middleware}.ts` — the three request clients.
    `core/supabase/admin.ts` — privileged service-role client; bypasses RLS, use
    only inside permission-gated server actions. See [`auth.md`](auth.md).
  - `core/auth/` — session guards and the `AuthProvider` abstraction. See
    [`auth.md`](auth.md).
  - `core/modules/registry.ts` — the feature registry + `ModuleDefinition` type.
    See [`modules.md`](modules.md).
- `src/modules/<feature>/` — **feature modules** (where the ERP grows). Each has an
  `index.ts` exporting a `ModuleDefinition` and a `components/` folder.
- `src/components/ui/` — shadcn primitives. `src/components/layout/` — app shell.
- `src/lib/` — generic helpers (`cn`).

## Authentication Flow

Three lines of defence, in order. Never bypass this flow.

1. `middleware.ts` — refreshes the session and guards `(app)` routes (first line).
2. `requireUser()` in `app/(app)/layout.tsx` — server-side guard (second line).
3. `core/auth` — all authentication goes through here.

Details (middleware, Supabase clients, Azure SSO, AuthProvider) live in
[`auth.md`](auth.md).

## Environment

Split by exposure — never mix the two.

- **Public variables** (`NEXT_PUBLIC_*`) — zod-validated in `core/config/env.ts`.
- **Server secrets** — `core/config/server-env.ts` (lazy, `server-only`). Never
  import this into client code.
