-- Deactivating a person (instead of hard-deleting them)
--
-- WHY: every action in the ERP records who did it (created a PO, approved an
-- invoice, logged a spend...). Those references deliberately BLOCK deleting a
-- user, so their history can never be silently erased. Trying to force-delete an
-- active user therefore failed with an unhelpful error.
--
-- Instead we DEACTIVATE: their login is banned (done in the server action via
-- the auth admin API) and we stamp `deactivated_at` here so the app can hide
-- them from active use. NULL = active. Fully reversible.

alter table public.profiles
  add column if not exists deactivated_at timestamptz;
