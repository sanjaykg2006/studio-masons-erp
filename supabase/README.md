# Database & migrations

The database structure lives in version-controlled **migration files** under
[`migrations/`](./migrations). Each file is a numbered SQL script that runs in
filename order. Treat them as the single source of truth for the schema — never
hand-edit the live database in ways that aren't captured here.

## One-time setup

1. Install the Supabase CLI so the `db:*` npm scripts below resolve `supabase`.
   See https://supabase.com/docs/guides/cli. (Or run any command via
   `npx supabase ...` without a global install.)
2. Link this repo to your Supabase project (asks for the project ref + DB
   password, stored locally, never committed):

   ```
   npm run db:link
   ```

## Everyday workflow

| Task | Command |
| --- | --- |
| Create a new, empty migration | `npm run db:new "short description"` |
| Apply pending migrations to the linked DB | `npm run db:push` |
| See how the live DB differs from the migrations | `npm run db:diff` |

Write the SQL into the file `db:new` creates, then `db:push` to apply it. Commit
the migration file alongside the code change that needs it.

## Why this matters

Applying schema changes by pasting SQL into the dashboard by hand is easy to get
wrong, hard to repeat exactly across environments, and leaves no record of what
was run. This workflow makes every change repeatable, reviewable, and reversible.

> Existing migrations (`0001_init.sql`, `0002_rbac.sql`) were written for the
> dashboard SQL editor and are already applied. From here on, use the workflow
> above so the repo and the database stay in lockstep.
