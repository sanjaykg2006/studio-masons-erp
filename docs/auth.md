# Authentication

Everything about how a user proves who they are. Enforcement of what they can *do*
lives in [`permissions.md`](permissions.md) and [`project-access.md`](project-access.md).

## Middleware

`middleware.ts` is the first line of defence. It refreshes the Supabase session on
every request and guards the `(app)` route group. It runs before any page code.

## Supabase clients

Three request-time clients in `core/supabase/`, one per context — use the right one:

- `client.ts` — browser client.
- `server.ts` — server components / server actions.
- `middleware.ts` — the session refresh used by `middleware.ts`.

Plus `core/supabase/admin.ts` — the privileged **service-role** client. It bypasses
RLS, so use it **only** inside a permission-gated server action, never on a page and
never without a permission check in front of it.

## AuthProvider

`core/auth/` wraps Supabase behind an `AuthProvider` abstraction:

- `actions.ts` — sign-in / sign-out server actions.
- `get-user.ts` — the `getUser` / `requireUser` guards used by protected layouts.
- `types.ts` — the `AuthProvider` abstraction that keeps the rest of the app from
  depending on Supabase directly.

## Azure SSO

Microsoft Entra ID (Azure) SSO is a drop-in, no refactor required:

1. Enable the Azure provider in Supabase.
2. Add a `signInWithOAuth("azure")` button.

Because everything already goes through `core/auth`, nothing else changes.
