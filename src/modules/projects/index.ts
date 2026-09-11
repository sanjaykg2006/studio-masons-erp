import { FolderKanban } from "lucide-react";

import type { ModuleDefinition } from "@/core/modules/registry";

/**
 * Projects — the company-wide Projects world (carved out of the old Design
 * module in Step 2 of the architecture plan). A project is tagged by department
 * and worked by several department teams at once; membership is controlled
 * per-department (each department's lead staffs their own team — see
 * can_manage_project_member in 0018). Owns the project list, per-project teams,
 * briefs and controlled folders. Permission sub-resources: project /
 * project.brief / project.member. Department-internal work (the questionnaire
 * template library, folder/stage/role settings) stays in the Design module.
 *
 * The implementation (data/actions/components + RFI + brief PDF) now lives here.
 * The one deliberate dependency back into Design is the template version-tree
 * loader (loadVersionTree/TemplateTree), since briefs are built from Design's
 * questionnaire templates.
 */

/** Project, briefs and membership: membership decides who sees a project. */
const MEMBERSHIP_ONLY = {
  department: "Who sees a project comes from project membership; a per-person tick would open every project.",
  company: "Who sees a project comes from project membership; a job-title tick would open every project.",
};

export const projectsModule: ModuleDefinition = {
  id: "project",
  label: "Projects",
  href: "/projects",
  icon: FolderKanban,
  nav: true,
  requires: { resource: "project", action: "read" },
  resources: [
    {
      id: "project",
      label: "Projects",
      actions: ["read", "create", "update", "approve", "delete"],
      // Everything about a project is set per project role. "Create" is the one
      // verb not tied to a single project: holding a role with it — on any
      // project, or on every project — lets that person start new ones
      // (can_create_project, 0078/0079).
      homes: ["project"],
      whyNot: MEMBERSHIP_ONLY,
      note: "Create = can start new projects",
    },
    {
      id: "project.brief",
      label: "Project · Briefs",
      actions: ["read", "create", "update", "review", "approve", "delete"],
      homes: ["project"],
      whyNot: MEMBERSHIP_ONLY,
    },
    {
      id: "project.member",
      label: "Project · Membership",
      // Reading the member list is gated by project:read; membership changes need
      // this "manage" verb. (No separate member:read verb — it was never checked.)
      actions: ["manage"],
      homes: ["project"],
      whyNot: MEMBERSHIP_ONLY,
    },
    {
      id: "project.template",
      label: "Project · Templates",
      actions: ["read", "create", "update", "approve", "delete"],
      // The shared library (brief question forms + the default checklist). Its
      // checks use has_permission_anywhere (0079), so all three places work.
      homes: ["project", "department", "company"],
      note: "Shared library — applies wherever the role is held",
    },
    {
      id: "folder.access",
      // The controlled-folder ACCESS grid (folder × role → View/Edit/Approve).
      // Allottable to any department: allot it and that department's settings
      // page grows its own folder-access grid, columns = its project roles. No
      // `homes` — it has its own dedicated grid, so it must NOT surface as a row
      // in the Project-roles or People & Access matrices; it just needs to be a
      // tickable department module. Enforcement is already role-based
      // (has_folder_capability), so no per-department gate is needed.
      label: "Controlled Folder Access",
      actions: ["read", "manage"],
    },
  ],
};
