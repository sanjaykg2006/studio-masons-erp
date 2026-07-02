-- Studio-Masons ERP — tidy: remove grants for verbs that were never enforced
-- Run AFTER 0032_verb_enforcement.sql.
--
-- BACKGROUND (from the verb audit)
--   A few verbs were declared/granted but nothing ever checked them, so they
--   granted nothing:
--     * design.folder:issue — GFC issuing is gated by folder "approve", not this.
--     * project.brief:issue  — no code path ever checks it.
--     * project.member:read  — the member list is gated by project:read instead.
--   They've been dropped from the module definitions; this removes the leftover
--   grant rows so the permission matrix and the data agree. Purely cosmetic — no
--   one loses any real ability.

delete from public.role_permissions
 where (resource = 'design.folder' and action = 'issue')
    or (resource = 'project.brief' and action = 'issue')
    or (resource = 'project.member' and action = 'read');

delete from public.team_member_permissions
 where (resource = 'design.folder' and action = 'issue')
    or (resource = 'project.brief' and action = 'issue')
    or (resource = 'project.member' and action = 'read');
