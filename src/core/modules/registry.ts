import type { LucideIcon } from "lucide-react";

import type { Action } from "@/core/rbac/types";
import { dashboardModule } from "@/modules/dashboard";
import { accessModule } from "@/modules/access";
import { auditModule } from "@/modules/audit";
import { projectsModule } from "@/modules/projects";
import { designModule } from "@/modules/design";
import { departmentsModule } from "@/modules/departments";
import { teamAccessModule } from "@/modules/team-access";

/**
 * A feature module's public contract.
 *
 * This is the single extension point of the ERP. Each feature lives in its own
 * folder under src/modules and exposes one ModuleDefinition. The app shell and
 * sidebar are generated from the registry below — they never hard-code routes.
 */
/** One gated resource shown as a row (with verb columns) in the access matrix. */
export type ModuleResource = {
  /** Permission `resource` id, e.g. "access" or "design.project". */
  id: string;
  /** Human label for the matrix row. */
  label: string;
  /** Verbs this resource supports (which checkboxes render). */
  actions: Action[];
  /**
   * Department-level capability (e.g. manage the template library, create
   * projects, edit settings) — granted per-person on the Team Access page.
   * Resources without this are project-level: access comes from project roles,
   * not Team Access. Default false.
   */
  departmentLevel?: boolean;
};

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
   * Modules with several gated resources (e.g. a project + its briefs +
   * templates + membership) declare them here. Each becomes its own matrix row
   * and its own permission `resource`. Takes precedence over `actions`.
   */
  resources?: ModuleResource[];
  /**
   * Permission required to show this module's sidebar link. Omit to always show
   * it. Independent of `actions` (which is matrix metadata only).
   */
  requires?: { resource: string; action: Action };
};

/** Flattened matrix rows: every gated resource across all modules, in order. */
export function moduleResources(): ModuleResource[] {
  return modules.flatMap((m) =>
    m.resources?.length
      ? m.resources
      : m.actions?.length
        ? [{ id: m.id, label: m.label, actions: m.actions }]
        : []
  );
}

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
  projectsModule,
  designModule,
  departmentsModule,
  teamAccessModule,
  accessModule,
  auditModule,
];

/** Modules that should appear in the sidebar, in order. */
export const navModules = modules.filter((m) => m.nav !== false);
