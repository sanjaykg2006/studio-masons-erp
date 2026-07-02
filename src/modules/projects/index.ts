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
 * NOTE: the implementation (data/actions/components) currently still lives under
 * src/modules/design; relocating it here is a follow-up tidy (Step 4).
 */
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
      // Creating projects is a department-wide capability (People & Access);
      // viewing/editing a project is a per-project-role ability.
      departmentLevel: true,
      projectRole: true,
      // Only "create" may be granted department-wide. View/edit/approve/delete a
      // project come from project MEMBERSHIP — a department-wide project:read tick
      // would silently expose every project ("membership decides visibility").
      departmentActions: ["create"],
    },
    {
      id: "project.brief",
      label: "Project · Briefs",
      actions: ["read", "create", "update", "review", "approve", "delete"],
      projectRole: true,
    },
    {
      id: "project.member",
      label: "Project · Membership",
      // Reading the member list is gated by project:read; membership changes need
      // this "manage" verb. (No separate member:read verb — it was never checked.)
      actions: ["manage"],
      projectRole: true,
    },
    {
      id: "project.template",
      label: "Project · Templates",
      actions: ["read", "create", "update", "approve", "delete"],
      // The general template library is a shared, department-level capability.
      departmentLevel: true,
    },
  ],
};
