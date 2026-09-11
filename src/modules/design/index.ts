import { PencilRuler } from "lucide-react";

import type { ModuleDefinition } from "@/core/modules/registry";

/**
 * Design Department — a department module. Since Step 2 of the architecture
 * plan, projects/briefs/folders live in the company-wide Projects module; Design
 * keeps its department-internal work: the versioned questionnaire template
 * library (used to build project briefs) and the folder catalogue / stage
 * checklist / project-role SETTINGS. Permission sub-resources: design.template /
 * design.folder. Reached through the Departments hub (not a top-level sidebar
 * item), like every other department.
 */
export const designModule: ModuleDefinition = {
  id: "design",
  label: "Design Department",
  href: "/design",
  icon: PencilRuler,
  nav: false,
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
      // Who manages Design's settings is now the department-wide "Settings"
      // ability every department has (People & Access). What is left here is
      // editing the shared twelve-folder catalogue, which stays admin-only, so
      // this row appears on no department screen.
      label: "Design · Folder catalogue",
      actions: ["read", "manage"],
    },
  ],
};
