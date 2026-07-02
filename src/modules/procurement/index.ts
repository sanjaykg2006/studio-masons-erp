import { ShoppingCart } from "lucide-react";

import type { ModuleDefinition } from "@/core/modules/registry";

/**
 * Procurement — the company's buying department. It runs its own internal work
 * (the vendor directory, budget BOQs, purchase intents, comparison, POs and
 * receipts) and reaches into projects to buy for them. Two-tier gating, mirroring
 * Design: the vendor directory is a GLOBAL library (has_permission); everything
 * project-tied is project-scoped (has_project_permission).
 *
 * Slice 1 (migration 0036) ships the department + the global vendor directory
 * only. The per-project resources (procurement.budget / .intent / .comparison /
 * .order / .receipt) are added as their slices land.
 */
export const procurementModule: ModuleDefinition = {
  id: "procurement",
  label: "Procurement",
  href: "/procurement",
  icon: ShoppingCart,
  // Reached through the Departments hub, not a top-level sidebar item.
  nav: false,
  requires: { resource: "procurement.vendor", action: "read" },
  resources: [
    {
      id: "procurement.vendor",
      label: "Procurement · Vendors",
      actions: ["read", "create", "update", "approve", "delete"],
      // The vendor directory is a shared, department-level library (Team Access).
      departmentLevel: true,
    },
  ],
};
