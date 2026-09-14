-- Studio-Masons ERP — one last tick that an approval stage replaced.
-- Run AFTER 0093_retire_ticks_that_stages_replaced.sql.
--
-- WHY
--   Retention · Manage was "approve an early release". 0091 moved that decision
--   onto the retention_early approval flow and 0092 gave the stage a named role,
--   so nothing checks the tick any more — no function, no policy. It is dropped
--   from the registry, and the grants people hold are cleared here so the matrix
--   never shows a ticked box that does nothing. 0092 read this grant to work out
--   the stage's role and ran first, so nothing is lost.

delete from public.role_permissions
where resource = 'finance.retention' and action = 'manage';

delete from public.team_member_permissions
where resource = 'finance.retention' and action = 'manage';
