# Migrations

The database is the real security boundary. App guards are convenience; RLS is what
stops a crafted request. Use existing migrations as templates.

## Permission-aware modules

For every new permission-aware module, in its migration:

- **Enable RLS** on each table (`enable row level security`).
- **Add a SELECT policy** — `for select using (has_permission('<id>','read'))`.
- **Add an INSERT policy** — `for insert with check (has_permission('<id>','create'))`.
- **Add an UPDATE policy** — `for update using (has_permission('<id>','update')) with check (has_permission('<id>','update'))`.
- **Add a DELETE policy** — `for delete using (has_permission('<id>','delete'))`.

For project-scoped tables, call `has_project_permission(project_id, '<id>', '<action>')`
instead — see [`project-access.md`](project-access.md).

## Applying

Apply with `npm run db:push`. A migration that isn't applied means the ticked
checkboxes in the access matrix are cosmetic — the module isn't really guarded until
the RLS policies exist in the database.
