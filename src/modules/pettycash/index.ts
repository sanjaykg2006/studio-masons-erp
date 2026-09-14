import { Wallet } from "lucide-react";

import type { ModuleDefinition } from "@/core/modules/registry";

/**
 * Petty Cash — a company-wide tool ANY employee can use to log a small spend and
 * claim/settle it. Unlike the rest of Finance it is not project-gated to create: it
 * shows in the sidebar for everyone (the module declares `resources`, not a top-level
 * `read` action, so the nav never hides it). An entry then runs a fixed chain —
 * Billing check → senior approval → Accounts pays — regardless of amount.
 *
 * Who approves the Billing check and Senior approval is no longer a tick: since
 * 0092 each approval stage names one role, set on Access Control → Approval
 * flows. What is left here is the work either side of those stages:
 *   pettycash.pay      Finance department's People & Access — pay a claim
 *   pettycash.entry    see everyone's claims (whoever a stage is waiting on can
 *                      already see that claim without this)
 *   pettycash.category Billing department's People & Access — the category list
 * Both are checked with has_permission, which reads job titles and People &
 * Access but never project roles.
 */
export const pettyCashModule: ModuleDefinition = {
  id: "pettycash",
  label: "Petty Cash",
  href: "/pettycash",
  icon: Wallet,
  resources: [
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
      note: "Everyone sees their own; whoever a stage is waiting on sees that claim too",
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
