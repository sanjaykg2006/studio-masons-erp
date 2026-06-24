-- Studio-Masons ERP — Governance access verbs
-- Run in the Supabase SQL Editor AFTER 0004_departments.sql.
--
-- WHY: the CRUD core (create/read/update/delete) can't express the Design
-- Department's governance rules, where "approve" and external "issue" must be
-- SEPARATE from "edit". This adds the four governance verbs to the action
-- vocabulary. has_permission() / my_permissions() are generic over app_action,
-- so they pick these up with no change.
--
--   review  — comment / check a deliverable before approval
--   approve — formally approve a deliverable (and gate status transitions)
--   issue   — release approved information externally / to site
--   manage  — add / remove members and their access (e.g. project membership)
--
-- NOTE: a newly added enum value cannot be USED in the same transaction it is
-- added in. This migration therefore only ADDS the values. The admin wildcard
-- backfill (which references them) lives at the top of 0006, a later migration
-- and thus a separate transaction.

alter type public.app_action add value if not exists 'review';
alter type public.app_action add value if not exists 'approve';
alter type public.app_action add value if not exists 'issue';
alter type public.app_action add value if not exists 'manage';
