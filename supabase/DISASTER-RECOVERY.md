# Disaster recovery & backups

How the Studio-Masons ERP database is protected, and exactly how to get it back
if data is lost. **A backup you have never restored is not a backup you can
trust** — so this document ends with a one-time drill you should actually
perform.

## Two layers of protection (defense in depth)

| Layer | What it is | Covers |
| --- | --- | --- |
| **1. Supabase automatic backups** | Backups the hosting provider takes for you. | Provider-side accidents, most "oops I deleted it" cases. |
| **2. Independent dumps** (`npm run db:backup`) | A full copy you take yourself and store somewhere you own. | The provider account being lost/locked, or a provider-wide failure. |

Relying on Layer 1 alone means a single point of failure (the Supabase account).
Layer 2 removes that.

---

## Layer 1 — Confirm Supabase automatic backups (do once)

In the Supabase dashboard:

1. Open the project → **Database** → **Backups**.
2. Note what's available on your current plan:
   - **Daily backups** — taken automatically. Check the list shows recent dates.
   - **Point-in-Time Recovery (PITR)** — restore to any moment (a paid add-on).
     Recommended once real business data is in the system.
3. If backups are not enabled / the plan doesn't include them, that's the moment
   to upgrade or to lean harder on Layer 2.

> Restoring from here is point-and-click: **Backups → choose a backup → Restore**.
> Note it **overwrites** the current database, so only do it deliberately.

---

## Layer 2 — Take your own independent backup

One command produces a complete, restorable snapshot (roles + schema + data):

```
npm run db:backup
```

It writes a timestamped folder under `./backups/` (which is git-ignored — these
files contain real data and must never be committed).

**Then copy that folder to storage you control** — OneDrive, an external drive,
or a cloud bucket. That copy is your safety net if the Supabase account is ever
unavailable.

Aim to run this on a regular cadence (e.g. weekly, or before any big change).
See "Automating it" below to put it on a schedule.

---

## How to restore from an independent backup

A snapshot folder contains three files, restored **in this order** against a
target database connection string (from Supabase → **Project Settings →
Database → Connection string**):

```
psql "<connection-string>" -f roles.sql
psql "<connection-string>" -f schema.sql
psql "<connection-string>" -f data.sql
```

- Restore into a **fresh / empty** project (or a scratch project for testing).
- `psql` ships with PostgreSQL; install the client tools if you don't have it.

---

## ✅ The one-time recovery drill (do this once, then note the date)

This proves the backups actually work. Pick the option that matches your plan:

**Option A — dashboard restore (simplest):**
1. In Supabase, create a throwaway test project.
2. Restore a backup into it (or follow the psql steps above using a Layer-2 dump).
3. Open the **Table Editor** and confirm your `profiles`, `roles`, and
   `audit_log` rows are present.
4. Delete the test project.

**Option B — verify a Layer-2 dump:**
1. Run `npm run db:backup`.
2. Open `schema.sql` and `data.sql` and confirm they contain your tables and rows
   (not empty).
3. (Best) Restore them into a scratch project per the steps above.

**Record the result:** _Last successful restore drill: __________ (date)._
Re-run the drill after any major schema change.

---

## Automating it (optional next step)

`npm run db:backup` can be put on a schedule (e.g. a daily/weekly GitHub Actions
job that runs the dump and uploads it to a private bucket using a stored database
connection secret). Not set up yet — ask and it can be added. Until then, run the
manual command on a calendar reminder.
