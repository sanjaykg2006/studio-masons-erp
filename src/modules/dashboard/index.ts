import { LayoutDashboard } from "lucide-react";

import type { ModuleDefinition } from "@/core/modules/registry";

/**
 * Dashboard module — the reference example. Copy this folder's shape
 * (index.ts + components/) to scaffold any new ERP feature.
 */
export const dashboardModule: ModuleDefinition = {
  id: "dashboard",
  label: "Dashboard",
  href: "/dashboard",
  icon: LayoutDashboard,
  nav: true,
  // The sidebar hides the link from anyone without `dashboard:read` (it's a
  // seeded general module, grantable to all). The page itself stays unguarded
  // as the post-redirect safe home.
  requires: { resource: "dashboard", action: "read" },
  resources: [
    { id: "dashboard", label: "Dashboard", actions: ["read"], homes: ["company"] },
  ],
};
