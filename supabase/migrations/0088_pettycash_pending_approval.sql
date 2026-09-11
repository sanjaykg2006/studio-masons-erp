-- Studio-Masons ERP — a petty-cash status for "in its approval stages".
-- Run AFTER 0087_change_orders_own_permission.sql.
--
-- Petty cash's approval steps become editable in 0089, so a claim waiting on
-- any of them is simply "pending_approval" (the stage it waits on is shown
-- from its approval request). A new enum value cannot be used in the same
-- transaction that adds it, so it gets its own migration.
alter type public.pettycash_status add value if not exists 'pending_approval' before 'pending_accounts';
