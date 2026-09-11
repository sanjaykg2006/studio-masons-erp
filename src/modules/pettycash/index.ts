import { Wallet } from "lucide-react";

import type { ModuleDefinition } from "@/core/modules/registry";

/**
 * Petty Cash — a company-wide tool ANY employee can use to log a small spend and
 * claim/settle it. Unlike the rest of Finance it is not project-gated to create: it
 * shows in the sidebar for everyone (the module declares `resources`, not a top-level
 * `read` action, so the nav never hides it). An entry then runs a fixed chain —
 * Billing check → MD approval → Accounts pays — regardless of amount.
 *
 * Each step is its own row, one verb each, held by the people who own it (0082):
 *   pettycash.billing  Billing department's People & Access
 *   pettycash.md       job title (Access Control)
 *   pettycash.pay      Finance department's People & Access
 *   pettycash.entry    job title — see everyone's claims (step owners see them too)
 *   pettycash.category Billing department's People & Access — the category list
 * Only the owner of the step a claim is waiting on may act on it (administrators
 * as a backup), and nobody acts on their own claim (pettycash_block_reason).
 */
export const pettyCashModule: ModuleDefinition = {
  id: "pettycash",
  label: "Petty Cash",
  href: "/pettycash",
  icon: Wallet,
  resources: [
    {
      id: "pettycash.billing",
      label: "Petty Cash · Billing check",
      actions: ["approve"],
      departmentLevel: true,
    },
    {
      id: "pettycash.md",
      label: "Petty Cash · MD approval",
      actions: ["approve"],
    },
    {
      id: "pettycash.pay",
      label: "Petty Cash · Pay",
      actions: ["issue"],
      departmentLevel: true,
    },
    {
      id: "pettycash.entry",
      label: "Petty Cash · See all claims",
      actions: ["read"],
    },
    {
      id: "pettycash.category",
      label: "Petty Cash · Categories",
      actions: ["manage"],
      departmentLevel: true,
    },
  ],
};
