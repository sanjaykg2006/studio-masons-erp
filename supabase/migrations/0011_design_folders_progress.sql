-- Studio-Masons ERP — Design Department: controlled folders + stage progress
-- Run AFTER 0010_department_leads.sql.
--
-- WHAT THIS ADDS
--   1. The 12 standard project folders as an EDITABLE catalogue (labels/order can
--      change later), plus a folder ACCESS matrix: a capability (view/edit/approve)
--      per (folder, design role). Defaults mirror the governance slide; an admin /
--      Senior Project Architect edits them in-app under /design/settings.
--   2. A simple, EDITABLE per-stage checklist (the 5 stages from the slide) and a
--      per-project record of which steps are done. The app derives two progress
--      bars from this: overall project % and the current stage's own %.
--
-- NEW PERMISSION RESOURCE (sub-resource of the 'design' module)
--   design.folder — read (see the rules) / manage (edit folders, access, checklist)
--
-- ENFORCEMENT
--   Catalogue/access/checklist are a shared, department-level configuration: read
--   for anyone with design access, write gated by has_permission('design.folder',
--   'manage'). Per-project step completion is project-scoped via the existing
--   has_project_permission() boundary (tick = needs project update).

-- 1. The 12 standard folders (a table, not an enum, so labels/order stay editable)
create table if not exists public.design_folder_types (
  key         text primary key,
  label       text not null,
  sort        int  not null default 0,
  description text
);

insert into public.design_folder_types (key, label, sort, description) values
  ('project_brief',     'Project Brief',         1,  'Project lead + design head'),
  ('site_information',  'Site Information',       2,  'Design + project team view'),
  ('working_drawings',  'Working Drawings',       3,  'Assigned design team edit'),
  ('mep_coordination',  'MEP Coordination',       4,  'Relevant consultants edit / review'),
  ('client_submissions','Client Submissions',     5,  'Project lead prepares; design head approves'),
  ('approved_design',   'Approved Design',        6,  'Read-only; design head controls'),
  ('gfc_issued',        'GFC Issued Drawings',    7,  'Controlled issue folder'),
  ('boq_specs',         'BOQ & Specifications',   8,  'QS / procurement relevant access'),
  ('dtm_rfis',          'DTM & RFIs',             9,  'Design + project + site updates'),
  ('change_orders',     'Change Order Register', 10,  'Design + QS + PMO control'),
  ('site_records',      'Site Records',          11,  'Site team update'),
  ('archive',           'Archive',               12,  'Design head / IT admin only')
on conflict (key) do nothing;

-- 2. Folder access matrix: highest capability a design role has on a folder.
--    'approve' implies edit+view, 'edit' implies view. Global defaults applied to
--    every project; absent row = no access.
create table if not exists public.design_folder_access (
  folder_key text not null references public.design_folder_types (key) on delete cascade,
  role_id    uuid not null references public.roles (id) on delete cascade,
  capability text not null check (capability in ('view', 'edit', 'approve')),
  primary key (folder_key, role_id)
);

-- Seed defaults from the governance slide, mapped onto the seven design roles.
insert into public.design_folder_access (folder_key, role_id, capability)
select g.folder_key, r.id, g.capability
from public.roles r
join (values
  -- Project Brief
  ('project_brief',     'design_senior_pa',    'approve'),
  ('project_brief',     'design_project_lead', 'edit'),
  ('project_brief',     'design_designer',     'view'),
  ('project_brief',     'design_junior',       'view'),
  ('project_brief',     'design_director',     'view'),
  -- Site Information
  ('site_information',  'design_senior_pa',    'view'),
  ('site_information',  'design_project_lead', 'edit'),
  ('site_information',  'design_designer',     'view'),
  ('site_information',  'design_junior',       'view'),
  ('site_information',  'design_site',         'view'),
  ('site_information',  'design_director',     'view'),
  -- Working Drawings
  ('working_drawings',  'design_senior_pa',    'approve'),
  ('working_drawings',  'design_project_lead', 'view'),
  ('working_drawings',  'design_designer',     'edit'),
  ('working_drawings',  'design_junior',       'edit'),
  ('working_drawings',  'design_director',     'view'),
  -- MEP Coordination
  ('mep_coordination',  'design_senior_pa',    'view'),
  ('mep_coordination',  'design_project_lead', 'view'),
  ('mep_coordination',  'design_designer',     'edit'),
  ('mep_coordination',  'design_site',         'edit'),
  ('mep_coordination',  'design_director',     'view'),
  -- Client Submissions
  ('client_submissions','design_senior_pa',    'approve'),
  ('client_submissions','design_project_lead', 'edit'),
  ('client_submissions','design_designer',     'view'),
  ('client_submissions','design_director',     'view'),
  -- Approved Design
  ('approved_design',   'design_senior_pa',    'approve'),
  ('approved_design',   'design_project_lead', 'view'),
  ('approved_design',   'design_designer',     'view'),
  ('approved_design',   'design_junior',       'view'),
  ('approved_design',   'design_site',         'view'),
  ('approved_design',   'design_vendor',       'view'),
  ('approved_design',   'design_director',     'view'),
  -- GFC Issued Drawings
  ('gfc_issued',        'design_senior_pa',    'approve'),
  ('gfc_issued',        'design_project_lead', 'view'),
  ('gfc_issued',        'design_designer',     'view'),
  ('gfc_issued',        'design_site',         'view'),
  ('gfc_issued',        'design_vendor',       'view'),
  ('gfc_issued',        'design_director',     'view'),
  -- BOQ & Specifications
  ('boq_specs',         'design_senior_pa',    'view'),
  ('boq_specs',         'design_project_lead', 'view'),
  ('boq_specs',         'design_site',         'edit'),
  ('boq_specs',         'design_director',     'view'),
  -- DTM & RFIs
  ('dtm_rfis',          'design_senior_pa',    'view'),
  ('dtm_rfis',          'design_project_lead', 'edit'),
  ('dtm_rfis',          'design_designer',     'edit'),
  ('dtm_rfis',          'design_site',         'edit'),
  ('dtm_rfis',          'design_director',     'view'),
  -- Change Order Register
  ('change_orders',     'design_senior_pa',    'approve'),
  ('change_orders',     'design_project_lead', 'view'),
  ('change_orders',     'design_site',         'edit'),
  ('change_orders',     'design_director',     'view'),
  -- Site Records
  ('site_records',      'design_senior_pa',    'view'),
  ('site_records',      'design_project_lead', 'view'),
  ('site_records',      'design_site',         'edit'),
  ('site_records',      'design_director',     'view'),
  -- Archive
  ('archive',           'design_senior_pa',    'approve'),
  ('archive',           'design_director',     'view')
) as g(folder_key, role_key, capability) on g.role_key = r.key
on conflict (folder_key, role_id) do nothing;

-- 3. Stage checklist — the 5 stages, each with editable steps. The current stage
--    and both progress bars are DERIVED from these (no status column needed).
create table if not exists public.design_stage_steps (
  id    uuid primary key default gen_random_uuid(),
  stage text not null check (stage in
    ('brief_concept','client_review','design_freeze','gfc_release','site_execution')),
  sort  int  not null default 0,
  label text not null
);

insert into public.design_stage_steps (stage, sort, label)
select s.stage, s.sort, s.label
from (values
  ('brief_concept',  1, 'Project brief approved'),
  ('brief_concept',  2, 'Site information collected'),
  ('brief_concept',  3, 'Concept drawings started'),
  ('client_review',  1, 'Reviewed files moved to Client Submissions'),
  ('client_review',  2, 'Client submission shared'),
  ('client_review',  3, 'Client feedback received'),
  ('design_freeze',  1, 'Client sign-off received'),
  ('design_freeze',  2, 'Approved Design folder locked'),
  ('gfc_release',    1, 'GFC package prepared'),
  ('gfc_release',    2, 'GFC drawings issued'),
  ('site_execution', 1, 'Latest drawings issued to site'),
  ('site_execution', 2, 'Site records kept up to date')
) as s(stage, sort, label)
-- only seed when the checklist is empty, so re-running never duplicates rows
where not exists (select 1 from public.design_stage_steps);

-- Per-project completion of each step.
create table if not exists public.design_project_steps (
  project_id uuid not null references public.design_projects (id) on delete cascade,
  step_id    uuid not null references public.design_stage_steps (id) on delete cascade,
  done       boolean not null default false,
  done_by    uuid references auth.users (id),
  done_at    timestamptz,
  primary key (project_id, step_id)
);

-- 4. RLS ----------------------------------------------------------------------
alter table public.design_folder_types  enable row level security;
alter table public.design_folder_access enable row level security;
alter table public.design_stage_steps   enable row level security;
alter table public.design_project_steps enable row level security;

-- Catalogue / access / checklist: a shared department config. Read for anyone with
-- design access; write only for design.folder:manage (admin via '*', Senior PA).
do $$
declare t text;
begin
  foreach t in array array[
    'design_folder_types', 'design_folder_access', 'design_stage_steps'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select using (has_design_access())',
      t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format(
      'create policy %I on public.%I for all using (has_permission(''design.folder'', ''manage'')) with check (has_permission(''design.folder'', ''manage''))',
      t || '_write', t);
  end loop;
end $$;

-- Per-project step completion: project-scoped. See if you can read the project;
-- tick/untick needs project update (Project Lead, Senior PA, Director).
drop policy if exists "design_project_steps_select" on public.design_project_steps;
create policy "design_project_steps_select" on public.design_project_steps
  for select using (has_project_permission(project_id, 'design.project', 'read'));

drop policy if exists "design_project_steps_write" on public.design_project_steps;
create policy "design_project_steps_write" on public.design_project_steps
  for all using (has_project_permission(project_id, 'design.project', 'update'))
  with check (has_project_permission(project_id, 'design.project', 'update'));

-- 5. Register the new design.folder sub-resource ------------------------------
insert into public.department_modules (department_id, module_id)
select d.id, 'design.folder'
from public.departments d
where d.key = 'design'
on conflict do nothing;

insert into public.module_settings (module_id, is_general)
values ('design.folder', false)
on conflict (module_id) do nothing;

-- Grant the new verbs to the existing design roles. Senior PA configures it;
-- everyone with design access can read the rules. (admin already holds '*'.)
insert into public.role_permissions (role_id, resource, action)
select r.id, g.resource, g.action::public.app_action
from public.roles r
join (values
  ('design_senior_pa',    'design.folder', 'read'),
  ('design_senior_pa',    'design.folder', 'manage'),
  ('design_director',     'design.folder', 'read'),
  ('design_project_lead', 'design.folder', 'read'),
  ('design_designer',     'design.folder', 'read'),
  ('design_junior',       'design.folder', 'read'),
  ('design_site',         'design.folder', 'read'),
  ('design_vendor',       'design.folder', 'read')
) as g(role_key, resource, action) on g.role_key = r.key
on conflict do nothing;
