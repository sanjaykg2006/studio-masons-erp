import { FileText, ShoppingCart } from "lucide-react";

import type { ModuleDefinition } from "@/core/modules/registry";

/**
 * Procurement — the company's buying department. It runs its own internal work
 * (the vendor directory, budget BOQs, purchase intents, POs and receipts) and
 * reaches into projects to buy for them. Two-tier gating, mirroring Design: the
 * vendor directory is a GLOBAL library (has_permission); everything project-tied
 * is project-scoped (has_project_permission).
 *
 * Project-scoped resources may be set per project role or per person on People
 * & Access (a per-person tick then applies on every project). The vendor list
 * only checks job titles and People & Access, never project roles. Every verb
 * listed here mirrors what the migrations enforce in RLS / the RPCs.
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
      note: "Approve = re-status a decided vendor; the first approval is set on Approval flows",
      homes: ["department", "company"],
    },
    {
      id: "procurement.budget",
      label: "Procurement · Budget BOQ",
      // approve = re-version a released budget (Director sign-off).
      actions: ["read", "create", "update", "approve", "delete"],
      homes: ["project", "department"],
      projectLink: { segment: "budget", icon: ShoppingCart },
    },
    {
      id: "procurement.intent",
      label: "Procurement · Purchase intents",
      actions: ["read", "create"],
      note: "Who signs an intent off is set on Access Control → Approval flows",
      homes: ["project", "department"],
      projectLink: { segment: "intents", icon: FileText },
    },
    {
      id: "procurement.order",
      label: "Procurement · Purchase orders",
      // issue = record/release a PO; approve = approve a cancellation;
      // manage = the senior sign-off that clears an over-budget PO for release.
      // Signing a PO off is an approval stage, not a tick.
      actions: ["read", "update", "approve", "issue", "manage"],
      note: "Approve = approve a cancellation; signing a PO off is set on Approval flows",
      homes: ["project", "department"],
      projectLink: { segment: "orders", icon: ShoppingCart },
    },
    {
      id: "procurement.receipt",
      label: "Procurement · Receipts",
      actions: ["read", "create", "update"],
      homes: ["project", "department"],
    },
  ],
};
