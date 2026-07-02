import { FileText, ShoppingCart } from "lucide-react";

import type { ModuleDefinition } from "@/core/modules/registry";

/**
 * Procurement — the company's buying department. It runs its own internal work
 * (the vendor directory, budget BOQs, purchase intents, comparison, POs and
 * receipts) and reaches into projects to buy for them. Two-tier gating, mirroring
 * Design: the vendor directory is a GLOBAL library (has_permission); everything
 * project-tied is project-scoped (has_project_permission).
 *
 * The global vendor directory (migration 0036) is a department-level library.
 * The per-project resources (procurement.budget / .intent / .comparison /
 * .order / .receipt, migrations 0037-0040) are project-scoped: their grants come
 * from a company-wide department role that reaches every project. Every verb
 * listed here mirrors what the migrations actually enforce in RLS / the RPCs, so
 * the access matrix shows a checkbox for each one.
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
    {
      id: "procurement.budget",
      label: "Procurement · Budget BOQ",
      // approve = re-version a released budget (Director sign-off).
      actions: ["read", "create", "update", "approve", "delete"],
      projectRole: true,
      projectLink: { segment: "budget", icon: ShoppingCart },
    },
    {
      id: "procurement.intent",
      label: "Procurement · Purchase intents",
      // approve = the Director's sign-off on a raised intent.
      actions: ["read", "create", "approve"],
      projectRole: true,
      projectLink: { segment: "intents", icon: FileText },
    },
    {
      id: "procurement.comparison",
      label: "Procurement · Comparisons",
      // approve = award the comparison (Director sign-off).
      actions: ["read", "create", "approve"],
      projectRole: true,
      projectLink: { segment: "comparisons", icon: FileText },
    },
    {
      id: "procurement.order",
      label: "Procurement · Purchase orders",
      // issue = record/release a PO; review = Finance; approve = Director.
      actions: ["read", "update", "review", "approve", "issue"],
      projectRole: true,
      projectLink: { segment: "orders", icon: ShoppingCart },
    },
    {
      id: "procurement.receipt",
      label: "Procurement · Receipts",
      actions: ["read", "create", "update"],
      projectRole: true,
    },
  ],
};
