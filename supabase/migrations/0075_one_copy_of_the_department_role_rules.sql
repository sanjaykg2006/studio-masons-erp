-- Studio-Masons ERP — Design's settings screens stop carrying their own copy of
-- the department-role rules.
-- Run AFTER 0074_all_projects_means_all_and_access_summary.sql.
--
-- THE DUPLICATION
--   design_settings_roles() and design_settings_role_permissions() ran the same
--   query as department_roles(dept) and department_role_permissions(dept) — but
--   behind a DIFFERENT permission gate:
--
--     design_settings_*   -> can_manage_design_roles()      = design.folder:manage
--     department_*        -> can_manage_department_roles(d) = lead of d OR access:update
--
--   So who may edit Design's project roles depended on which screen you opened.
--   That is not a risk of drifting apart later; the two copies already disagreed.
--
--   Design was split into the generic Departments module long ago, and these
--   were the last two functions still holding a private copy of its rules.
--
-- WHAT CHANGES
--   They become thin wrappers that pass the Design department to the generic
--   functions. The screens keep their existing call, but there is now ONE
--   implementation and ONE gate, so a change to department_roles reaches Design
--   automatically.
--
--   CONSEQUENCE, deliberately: editing Design's project roles and folder access
--   now needs the same thing as every other department — being a lead of Design,
--   or holding access:update. Holding design.folder:manage alone is no longer
--   enough. Today only the Senior Project Architect role carries that grant, and
--   nobody holds it as a job title, so nobody loses anything right now. To give
--   a Senior Project Architect that power back, make them a Design lead.

create or replace function public.design_settings_roles()
returns table (
  id uuid, key text, label text, description text,
  is_system boolean, rank integer
)
language sql stable security definer set search_path = public
as $$
  select * from public.department_roles(public.design_department_id());
$$;

comment on function public.design_settings_roles() is
  'Design''s project roles. A wrapper over department_roles so the rule and its permission gate exist in one place only.';

create or replace function public.design_settings_role_permissions()
returns table (role_id uuid, resource text, action public.app_action)
language sql stable security definer set search_path = public
as $$
  select * from public.department_role_permissions(public.design_department_id());
$$;

comment on function public.design_settings_role_permissions() is
  'Grants on Design''s project roles. A wrapper over department_role_permissions so the rule exists in one place only.';

-- ── Flagging the one duplication that cannot be collapsed ───────────────────
-- The invoice money math is deliberately written twice: once in SQL here (what
-- is actually saved) and once in TypeScript (computeApproval, which draws the
-- live preview before anyone approves). Neither can call the other — the
-- preview must run in the browser with no round trip, and the database must not
-- trust a figure the browser sent it.
--
-- So they are mirrored by hand, and the comments below say so on both sides.
-- src/modules/finance/money.test.ts locks the agreed rules for both.
comment on function public.accounts_approve_invoice(uuid, jsonb, numeric, numeric, boolean, numeric, boolean, text) is
  'Authoritative invoice math. MIRRORED BY computeApproval in src/modules/finance/types.ts, which draws the preview - change both together, and check src/modules/finance/money.test.ts still passes.';
