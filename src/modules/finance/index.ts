import { Landmark, Receipt } from "lucide-react";

import type { ModuleDefinition } from "@/core/modules/registry";

/**
 * Finance — the company's "money desk". It sits ON TOP of Procurement's purchase
 * orders and runs everything that happens after a vendor has a PO: vendor invoices,
 * payment requests, advances, retention, and the billing-branch list.
 *
 * Everything project-tied is project-scoped (has_project_permission): set per
 * project role, or per person on People & Access (then on every project).
 * Billing branches are a company-wide setting (has_permission). Reached through
 * the Departments hub (the /finance dashboard) and through each project (the
 * `finance.invoice` projectLink surfaces a "Finance" card). Every verb here
 * mirrors what migration 0060 enforces.
 *
 * Since 0092 the sign-offs themselves are approval STAGES, each naming one role
 * on Access Control → Approval flows — not ticks. What is left here is the work
 * either side of a stage:
 *   finance.invoice   create → PM · review → Accounts (books it, and may reject
 *                     one) · approve → also lets Accounts reject · manage →
 *                     PD/MD (PO-cap override)
 *   finance.payment   create → PM · issue → Accounts (pay)
 *   finance.retention issue → Accounts (pay) · update → Director (request early)
 *   finance.advance   update → request/terms · issue → Accounts (pay)
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
      note: "Approve = may also reject at booking; the sign-off itself is set on Approval flows",
      homes: ["project", "department"],
      projectLink: { segment: "finance", icon: Receipt },
    },
    {
      id: "finance.payment",
      label: "Finance · Payment requests",
      actions: ["read", "create", "issue"],
      note: "Who approves a request is set on Access Control → Approval flows",
      homes: ["project", "department"],
    },
    {
      id: "finance.retention",
      label: "Finance · Retention",
      actions: ["read", "update", "issue"],
      note: "Who approves an early release is set on Access Control → Approval flows",
      homes: ["project", "department"],
    },
    {
      id: "finance.advance",
      label: "Finance · Advances & PO terms",
      actions: ["read", "update", "issue"],
      note: "Who approves an advance is set on Access Control → Approval flows",
      homes: ["project", "department"],
    },
    {
      id: "finance.settings",
      label: "Finance · Billing branches",
      actions: ["read", "manage"],
      homes: ["department", "company"],
    },
  ],
};
