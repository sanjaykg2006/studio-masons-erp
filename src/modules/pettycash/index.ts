import { Wallet } from "lucide-react";

import type { ModuleDefinition } from "@/core/modules/registry";

/**
 * Petty Cash — a company-wide tool ANY employee can use to log a small spend and
 * claim/settle it. Unlike the rest of Finance it is not project-gated to create: it
 * shows in the sidebar for everyone (the module declares `resources`, not a top-level
 * `read` action, so the nav never hides it). An entry then runs a fixed chain —
 * Billing approves → MD approves → Accounts pays — regardless of amount.
 *
 *   pettycash.entry    read = see EVERYONE's entries (Billing/Accounts/MD) ·
 *                      approve = Billing · manage = MD · issue = Accounts (pay).
 *                      Creating an entry is ungated (any employee).
 *   pettycash.category manage = Billing edits the category list.
 */
export const pettyCashModule: ModuleDefinition = {
  id: "pettycash",
  label: "Petty Cash",
  href: "/pettycash",
  icon: Wallet,
  resources: [
    {
      id: "pettycash.entry",
      label: "Petty Cash · Entries",
      actions: ["read", "approve", "issue", "manage"],
      departmentLevel: true,
    },
    {
      id: "pettycash.category",
      label: "Petty Cash · Categories",
      actions: ["read", "manage"],
      departmentLevel: true,
    },
  ],
};
