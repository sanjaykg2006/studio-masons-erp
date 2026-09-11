-- Studio-Masons ERP — the folder catalogue stops being Design's private data
-- Run AFTER 0076_project_owned_checklists.sql.
--
-- WHAT WAS WRONG
--   design_folder_types is the list of twelve folders EVERY project has, whoever
--   owns it. Its read gate was has_design_access() — design.template:read or
--   design.folder:read — left over from when Projects lived inside Design.
--
--   The project screens were never affected: design_project_folders and
--   design_folder_rank are SECURITY DEFINER and gate on can_view_project, so
--   they read the catalogue past its own RLS. The damage was on the SETTINGS
--   grids, which read the tables directly as the signed-in user:
--
--     * A Project Management or Finance lead opening their own department's
--       controlled-folder grid got the roles and capabilities (those come from a
--       SECURITY DEFINER RPC) but no folder rows at all — an empty grid with no
--       explanation.
--     * Since 0075 the Design settings page admits a lead of Design or an
--       access admin, who may hold neither Design grant, so it emptied there too.
--
-- WHAT CHANGES
--   Reading the catalogue needs only a signed-in account. It is twelve labels —
--   "Working Drawings", "GFC Issued" — and every project viewer can already see
--   them through design_project_folders, so this exposes nothing that was not
--   already on screen. It matches pettycash_categories and billing_branches,
--   which are gated the same way for the same reason.
--
--   Reading the access grid (which role may view/edit/approve which folder) now
--   also admits an access admin and any department lead, alongside the existing
--   Design readers — the people the two settings screens are built for.
--
--   WRITING both tables is untouched: still design.folder:manage, or the
--   set_department_folder_access RPC, which re-checks that the caller manages
--   the department whose roles they are editing. Nobody gains the ability to
--   change a folder rule, or to open a file they could not open before — file
--   access runs through has_folder_capability, which this does not touch.

drop policy if exists "design_folder_types_select" on public.design_folder_types;
create policy "design_folder_types_select" on public.design_folder_types
  for select using (auth.uid() is not null);

comment on table public.design_folder_types is
  'The folders every project has, whichever department owns it. Company-wide, not Design-specific.';

drop policy if exists "design_folder_access_select" on public.design_folder_access;
create policy "design_folder_access_select" on public.design_folder_access
  for select using (
    has_permission('access', 'read')
    or leads_any_department()
    or has_design_access()
  );
