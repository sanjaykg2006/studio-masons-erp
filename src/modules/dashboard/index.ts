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
  // Appears in the access-control matrix. No `requires`, so the nav link stays
  // ungated — the dashboard is everyone's safe home.
  actions: ["read"],
};
