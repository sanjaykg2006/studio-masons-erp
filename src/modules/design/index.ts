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
      // This ability is "may manage Design's settings" (the settings page: folder
      // RULES, stage checklist, project roles) — a department-wide admin grant. The
      // actual per-project folder ACCESS is a separate role→folder grid enforced
      // per project (has_folder_capability), configured inside those settings.
      label: "Design · Settings",
      // Issuing the GFC package is gated by folder "approve" capability, not a
      // design.folder:issue verb — so only read + manage are real here.
      actions: ["read", "manage"],
      // Managing the department's settings is a department-wide capability
      // (People & Access), not a per-project role ability — so no projectRole.
      departmentLevel: true,
    },
  ],
};
