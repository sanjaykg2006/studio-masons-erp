import { Wallet } from "lucide-react";

import type { ModuleDefinition } from "@/core/modules/registry";

/**
 * Petty Cash — a company-wide tool ANY employee can use to log a small spend and
 * claim/settle it. Unlike the rest of Finance it is not project-gated to create: it
 * shows in the sidebar for everyone (the module declares `resources`, not a top-level
 * `read` action, so the nav never hides it). An entry then runs a fixed chain —
 * Billing check → senior approval → Accounts pays — regardless of amount.
 *
 * Each step is its own row, one verb each (0082/0083). By default:
 *   pettycash.billing  Billing department's People & Access
 *   pettycash.senior   job title — and only for claims from someone BELOW the
 *                      approver in the job-title order
 *   pettycash.pay      Finance department's People & Access
 *   pettycash.entry    job title — see everyone's claims (step owners see them too)
 *   pettycash.category Billing department's People & Access — the category list
 * All are checked with has_permission, which reads job titles and People &
 * Access but never project roles. Only the owner of the step a claim is waiting
 * on may act on it (administrators as a backup), and nobody acts on their own
 * claim (pettycash_block_reason).
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
      homes: ["department", "company"],
    },
    {
      id: "pettycash.senior",
      label: "Petty Cash · Senior approval",
      actions: ["approve"],
      homes: ["company", "department"],
    },
    {
      id: "pettycash.pay",
      label: "Petty Cash · Pay",
      actions: ["issue"],
      homes: ["department", "company"],
    },
    {
      id: "pettycash.entry",
      label: "Petty Cash · See all claims",
      actions: ["read"],
      homes: ["company", "department"],
    },
    {
      id: "pettycash.category",
      label: "Petty Cash · Categories",
      actions: ["manage"],
      homes: ["department", "company"],
    },
  ],
};
