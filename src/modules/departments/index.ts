import { Building2 } from "lucide-react";

import type { ModuleDefinition } from "@/core/modules/registry";

/**
 * Departments hub — a per-department workspace (task board + roles settings) for
 * every department the user belongs to. Its sidebar link is gated by a synthetic
 * "department.workspace:read" hint injected in the (app) layout when the user is
 * on any department's team or leads one. The real boundary is each RPC's own
 * department check.
 */
export const departmentsModule: ModuleDefinition = {
  id: "departments",
  label: "Departments",
  href: "/departments",
  icon: Building2,
  nav: true,
  requires: { resource: "department.workspace", action: "read" },
};
