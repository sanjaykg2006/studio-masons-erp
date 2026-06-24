-- Studio-Masons ERP — Design Department roles + permission matrix
-- Run AFTER 0007_design_templates_seed.sql.
--
-- Seeds the seven roles from the governance framework, scoped to the resources
-- that exist today (design.project / design.brief / design.template /
-- design.member). Verbs for not-yet-built resources (GFC issue folders, change
-- registers) get added when those ship.
--
-- HOW THEY'RE ASSIGNED
--   * Director & Senior Project Architect are intended as DEPARTMENT-WIDE roles
--     (set as a user's global role via /access). Their grants then apply to
--     every design project through has_project_permission()'s global branch.
--   * Project Lead, Designer, Junior, Site/MEP/QS and Vendor are intended for
--     PER-PROJECT assignment (added to a project as that role). Their grants
--     apply only on the projects they're a member of.
-- Both live in the same roles table under the Design department; the difference
-- is only how an admin assigns them.

-- 1. The roles ---------------------------------------------------------------
insert into public.roles (key, label, description, is_system, department_id)
select v.key, v.label, v.descr, false, d.id
from public.departments d
cross join (values
  ('design_director',     'Director',                 'Final visibility, major approvals, escalations.'),
  ('design_senior_pa',    'Senior Project Architect', 'Access governance, final design approval, GFC issue control.'),
  ('design_project_lead', 'Project Lead',             'Project ownership, coordination, review and tracker control.'),
  ('design_designer',     'Designer',                 'Creates and edits working design; views approved.'),
  ('design_junior',       'Junior / Intern',          'Limited create; mostly view.'),
  ('design_site',         'Site / MEP / QS',          'Views relevant issued information; reviews.'),
  ('design_vendor',       'Vendor',                   'Views issued information only.')
) as v(key, label, descr)
where d.key = 'design'
on conflict (key) do nothing;

-- 2. The matrix --------------------------------------------------------------
-- (role_key, resource, action) tuples. The 0004 guard permits these because the
-- four design sub-resources are registered to the Design department in 0006.
insert into public.role_permissions (role_id, resource, action)
select r.id, g.resource, g.action::public.app_action
from public.roles r
join (values
  -- Director — view across the board, approve briefs, finalise projects
  ('design_director', 'design.project', 'read'),
  ('design_director', 'design.project', 'approve'),
  ('design_director', 'design.brief',   'read'),
  ('design_director', 'design.brief',   'approve'),
  ('design_director', 'design.template','read'),
  ('design_director', 'design.member',  'read'),

  -- Senior Project Architect — full control + manage access (the design admin)
  ('design_senior_pa', 'design.project', 'read'),
  ('design_senior_pa', 'design.project', 'create'),
  ('design_senior_pa', 'design.project', 'update'),
  ('design_senior_pa', 'design.project', 'approve'),
  ('design_senior_pa', 'design.project', 'delete'),
  ('design_senior_pa', 'design.brief',   'read'),
  ('design_senior_pa', 'design.brief',   'create'),
  ('design_senior_pa', 'design.brief',   'update'),
  ('design_senior_pa', 'design.brief',   'review'),
  ('design_senior_pa', 'design.brief',   'approve'),
  ('design_senior_pa', 'design.brief',   'issue'),
  ('design_senior_pa', 'design.brief',   'delete'),
  ('design_senior_pa', 'design.template','read'),
  ('design_senior_pa', 'design.template','create'),
  ('design_senior_pa', 'design.template','update'),
  ('design_senior_pa', 'design.template','delete'),
  ('design_senior_pa', 'design.member',  'read'),
  ('design_senior_pa', 'design.member',  'manage'),

  -- Project Lead — runs the project, reviews, manages its membership
  ('design_project_lead', 'design.project', 'read'),
  ('design_project_lead', 'design.project', 'update'),
  ('design_project_lead', 'design.brief',   'read'),
  ('design_project_lead', 'design.brief',   'create'),
  ('design_project_lead', 'design.brief',   'update'),
  ('design_project_lead', 'design.brief',   'review'),
  ('design_project_lead', 'design.template','read'),
  ('design_project_lead', 'design.member',  'read'),
  ('design_project_lead', 'design.member',  'manage'),

  -- Designer — creates/edits the working brief, views the rest
  ('design_designer', 'design.project', 'read'),
  ('design_designer', 'design.brief',   'read'),
  ('design_designer', 'design.brief',   'create'),
  ('design_designer', 'design.brief',   'update'),
  ('design_designer', 'design.template','read'),
  ('design_designer', 'design.member',  'read'),

  -- Junior / Intern — limited create, mostly view
  ('design_junior', 'design.project', 'read'),
  ('design_junior', 'design.brief',   'read'),
  ('design_junior', 'design.brief',   'create'),
  ('design_junior', 'design.template','read'),
  ('design_junior', 'design.member',  'read'),

  -- Site / MEP / QS — view relevant, review
  ('design_site', 'design.project', 'read'),
  ('design_site', 'design.brief',   'read'),
  ('design_site', 'design.brief',   'review'),
  ('design_site', 'design.template','read'),
  ('design_site', 'design.member',  'read'),

  -- Vendor — view only
  ('design_vendor', 'design.project', 'read'),
  ('design_vendor', 'design.brief',   'read')
) as g(role_key, resource, action) on g.role_key = r.key
on conflict do nothing;
