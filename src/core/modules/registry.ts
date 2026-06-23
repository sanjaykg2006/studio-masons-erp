import type { LucideIcon } from "lucide-react";

import { dashboardModule } from "@/modules/dashboard";

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
export const modules: ModuleDefinition[] = [dashboardModule];

/** Modules that should appear in the sidebar, in order. */
export const navModules = modules.filter((m) => m.nav !== false);
