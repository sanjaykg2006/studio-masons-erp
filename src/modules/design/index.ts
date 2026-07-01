import { PencilRuler } from "lucide-react";

import type { ModuleDefinition } from "@/core/modules/registry";

/**
 * Design Department — a department module. Since Step 2 of the architecture
 * plan, projects/briefs/folders live in the company-wide Projects module; Design
 * keeps its department-internal work: the versioned questionnaire template
 * library (used to build project briefs) and the folder catalogue / stage
 * checklist / project-role SETTINGS. Permission sub-resources: design.template /
 * design.folder. The sidebar link shows for anyone who can read the templates.
 */
export const designModule: ModuleDefinition = {
  id: "design",
  label: "Design Department",
  href: "/design",
  icon: PencilRuler,
  nav: true,
  requires: { resource: "design.template", action: "read" },
  resources: [
    {
      id: "design.template",
      label: "Design · Templates",
      actions: ["read", "create", "update", "delete"],
      // The template library is shared across the department.
      departmentLevel: true,
    },
    {
      id: "design.folder",
      label: "Design · Folders & Settings",
      actions: ["read", "issue", "manage"],
      // Folder catalogue, stage checklist + project-role settings are dept-level.
      departmentLevel: true,
    },
  ],
};
