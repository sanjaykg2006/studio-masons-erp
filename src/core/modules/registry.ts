import type { LucideIcon } from "lucide-react";

import type { Action } from "@/core/rbac/types";
import { dashboardModule } from "@/modules/dashboard";
import { accessModule } from "@/modules/access";
import { auditModule } from "@/modules/audit";

/**
 * A feature module's public contract.
 *
 * This is the single extension point of the ERP. Each feature lives in its own
 * folder under src/modules and exposes one ModuleDefinition. The app shell and
 * sidebar are generated from the registry below — they never hard-code routes.
 */
export type ModuleDefinition = {
  /** Stable unique id, e.g. "dashboard", "projects". */
  id: string;
  /** Human label shown in navigation. */
  label: string;
  /** Route this module owns, e.g. "/dashboard". Must exist under app/(app). */
  href: string;
  /** Sidebar icon. */
  icon: LucideIcon;
  /** Whether to show this module in the sidebar nav. Default: true. */
  nav?: boolean;
  /**
   * CRUD actions this module exposes to RBAC. The module id doubles as the
   * permission `resource`. Listed here so the access-control matrix knows which
   * checkboxes to render for this module. Omit if the module isn't gated.
   */
  actions?: Action[];
  /**
   * Permission required to show this module's sidebar link. Omit to always show
   * it. Independent of `actions` (which is matrix metadata only).
   */
  requires?: { resource: string; action: Action };
};

/**
 * THE REGISTRY — register every feature module here.
 *
 * To add a feature later:
 *   1. Create src/modules/<feature>/ with an index.ts exporting a ModuleDefinition.
 *   2. Create the route at src/app/(app)/<feature>/page.tsx.
 *   3. Add the module to this array.
 * The sidebar updates automatically. Nothing else to wire up.
 */
export const modules: ModuleDefinition[] = [
  dashboardModule,
  accessModule,
  auditModule,
];

/** Modules that should appear in the sidebar, in order. */
export const navModules = modules.filter((m) => m.nav !== false);
