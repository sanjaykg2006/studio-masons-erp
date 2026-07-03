-- Studio-Masons ERP — Procurement: add the 'cancelled' order status
-- Run AFTER 0051_procurement_intent_location.sql.
--
-- This is deliberately its OWN migration: a newly added enum value cannot be used
-- in the same transaction that adds it, and the cancel RPCs in 0053 reference
-- 'cancelled'. Keeping the ADD VALUE alone ensures it is committed first (mirrors
-- how 0043 added 'amending').

alter type public.procurement_order_status add value if not exists 'cancelled';
