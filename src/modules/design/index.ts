import { PencilRuler } from "lucide-react";

import type { ModuleDefinition } from "@/core/modules/registry";

/**
 * Design Department — a department module. Since Step 2 of the architecture
 * plan, projects/briefs/folders live in the company-wide Projects module; Design
 * keeps its department-internal work: the versioned questionnaire template
 * library (used to build project briefs) and its project-role / folder-access
 * SETTINGS. Permission sub-resources: design.template / design.folder. Reached
 * through the Departments hub (not a top-level sidebar item), like every other
 * department.
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
      homes: ["department", "company"],
    },
    {
      id: "design.folder",
      // Who manages Design's settings is the "Settings" ability every
      // department has. What is left here is editing the shared twelve-folder
      // catalogue (design_folder_types).
      label: "Design · Folder catalogue",
      actions: ["read", "manage"],
      homes: ["company", "department"],
    },
  ],
};
