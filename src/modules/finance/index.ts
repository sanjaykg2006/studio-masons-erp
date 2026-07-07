import { Landmark, Receipt } from "lucide-react";

import type { ModuleDefinition } from "@/core/modules/registry";

/**
 * Finance — the company's "money desk". It sits ON TOP of Procurement's purchase
 * orders and runs everything that happens after a vendor has a PO: vendor invoices,
 * payment requests, advances, retention, and the billing-branch list.
 *
 * Everything project-tied is project-scoped (has_project_permission); the finance
 * team gets all-projects visibility via department-wide roles. Billing branches are
 * a company-wide setting (has_permission). Reached through the Departments hub (the
 * /finance dashboard) and through each project (the `finance.invoice` projectLink
 * surfaces a "Finance" card). Every verb here mirrors what migration 0060 enforces.
 *
 *   finance.invoice   create → PM · approve → Project Director · review → Accounts
 *                     (books it) · manage → PD/MD (PO-cap override)
 *   finance.payment   create → PM · approve → Project Director · issue → Accounts (pay)
 *   finance.retention issue → Accounts (pay) · update → Director (request early) ·
 *                     manage → MD (approve early release)
 *   finance.advance   update → request/terms · approve → Project Director · issue →
 *                     Accounts (pay)
 *   finance.settings  manage → Finance/Billing (billing branches)
 */
export const financeModule: ModuleDefinition = {
  id: "finance",
  label: "Finance",
  href: "/finance",
  icon: Landmark,
  // Reached through the Departments hub + each project, not a top-level sidebar item.
  nav: false,
  requires: { resource: "finance.invoice", action: "read" },
  resources: [
    {
      id: "finance.invoice",
      label: "Finance · Vendor invoices",
      actions: ["read", "create", "approve", "review", "manage", "delete"],
      projectRole: true,
      projectLink: { segment: "finance", icon: Receipt },
    },
    {
      id: "finance.payment",
      label: "Finance · Payment requests",
      actions: ["read", "create", "approve", "issue"],
      projectRole: true,
    },
    {
      id: "finance.retention",
      label: "Finance · Retention",
      actions: ["read", "update", "issue", "manage"],
      projectRole: true,
    },
    {
      id: "finance.advance",
      label: "Finance · Advances & PO terms",
      actions: ["read", "update", "approve", "issue"],
      projectRole: true,
    },
    {
      id: "finance.settings",
      label: "Finance · Billing branches",
      actions: ["read", "manage"],
      departmentLevel: true,
    },
  ],
};
