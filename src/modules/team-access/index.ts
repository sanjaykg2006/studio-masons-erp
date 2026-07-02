import { ShieldCheck } from "lucide-react";

import type { ModuleDefinition } from "@/core/modules/registry";

/**
 * Team Access — a department lead's self-service page. Shows only the
 * department(s) the signed-in user leads: that department's roles, their
 * permission matrix (the department's own modules), and its people.
 *
 * It is NOT a gated data resource (no `actions`/`resources`), so it never appears
 * as a row in the central Access Control matrix. The sidebar link is shown only
 * to department leads — the (app) layout injects a `team.access:read` nav hint
 * when leads_any_department() is true (mirrors the Design module's hint).
 */
export const teamAccessModule: ModuleDefinition = {
  id: "team-access",
  label: "Team Access",
  href: "/team",
  icon: ShieldCheck,
  // Folded into each department's "People & Access" screen — no longer a separate
  // sidebar door. /team now redirects there. Kept in the registry for the route.
  nav: false,
  requires: { resource: "team.access", action: "read" },
};
