import { PencilRuler } from "lucide-react";

import type { ModuleDefinition } from "@/core/modules/registry";

/**
 * Design Department — the first business module. Owns projects (draft →
 * finalised), their briefs (built from versioned questionnaire templates),
 * per-project membership, and the template library. Permissions use four
 * sub-resources (design.project / design.brief / design.template / design.member);
 * the sidebar link shows for anyone who can read projects.
 */
export const designModule: ModuleDefinition = {
  id: "design",
  label: "Design Department",
  href: "/design",
  icon: PencilRuler,
  nav: true,
  requires: { resource: "design.project", action: "read" },
  resources: [
    {
      id: "design.project",
      label: "Design · Projects",
      actions: ["read", "create", "update", "approve", "delete"],
    },
    {
      id: "design.brief",
      label: "Design · Briefs",
      actions: ["read", "create", "update", "review", "approve", "issue", "delete"],
    },
    {
      id: "design.template",
      label: "Design · Templates",
      actions: ["read", "create", "update", "delete"],
    },
    {
      id: "design.member",
      label: "Design · Membership",
      actions: ["read", "manage"],
    },
  ],
};
