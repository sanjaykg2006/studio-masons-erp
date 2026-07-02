-- Studio-Masons ERP — Procurement: add the 'amending' order status
-- Run AFTER 0042_procurement_import.sql.
--
-- This is deliberately its OWN migration: a newly added enum value cannot be used
-- in the same transaction that adds it, and the amendment functions in 0044
-- reference 'amending'. Keeping the ADD VALUE alone ensures it is committed first.

alter type public.procurement_order_status add value if not exists 'amending';
