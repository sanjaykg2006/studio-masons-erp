-- 0095 — Placeholder approvers for the five stages 0092 could not bind.
--
-- Nobody held the old tick for these stages, so 0092 left role_id empty and
-- only a full-access admin could decide them. These are stop-gap picks, meant
-- to be reviewed on Access Control → Approval flows. Only stages still empty
-- are touched, so anything already chosen there is kept.
--
-- Petty Cash and Vendor items carry no project, so their approver must be a
-- job title (holds_role never matches a department role off a project).
--
--   order / Finance review ...... Finance Head (project role — must be on the
--                                 project or have the "every project" switch)
--   order / Director approval ... Managing Director
--   pettycash / Billing check ... Administrator
--   pettycash / Senior approval . Managing Director
--   vendor / Approve ............ Managing Director

update public.approval_stages s
   set approver = 'role',
       role_id  = r.id
  from (values
    ('order',     'Finance review',    'finance_head'),
    ('order',     'Director approval', 'md'),
    ('pettycash', 'Billing check',     'admin'),
    ('pettycash', 'Senior approval',   'md'),
    ('vendor',    'Approve',           'md')
  ) as pick(flow_id, label, role_key)
  join public.roles r on r.key = pick.role_key
 where s.flow_id = pick.flow_id
   and s.label   = pick.label
   and s.role_id is null;
