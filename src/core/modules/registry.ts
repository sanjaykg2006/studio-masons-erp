import type { LucideIcon } from "lucide-react";

import type { Action } from "@/core/rbac/types";
import { dashboardModule } from "@/modules/dashboard";
import { accessModule } from "@/modules/access";
import { auditModule } from "@/modules/audit";
import { errorLogModule } from "@/modules/errorlog";
import { projectsModule } from "@/modules/projects";
import { designModule } from "@/modules/design";
import { procurementModule } from "@/modules/procurement";
import { inventoryModule } from "@/modules/inventory";
import { financeModule } from "@/modules/finance";
import { pettyCashModule } from "@/modules/pettycash";
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
   * Used only inside the department (its tasks, settings, template library,
   * vendor list…) — granted PER PERSON on the People & Access page. Default false.
   *
   * Every resource has exactly ONE home: `departmentLevel` (People & Access),
   * `projectRole` (Settings → Project roles), or neither — a company-wide screen
   * given with the job title in Access Control. Never set both.
   */
  departmentLevel?: boolean;
  /**
   * Per-project capability — granted PER ROLE on a department's "Project roles"
   * matrix (what a role can do ON a project: view/edit the project, briefs,
   * membership, budget, orders…).
   */
  projectRole?: boolean;
  /**
   * Built into every department (its tasks, settings and people), so it needs no
   * module allotting and never appears on Access Control. Mirrors
   * is_department_ability() in the database.
   */
  everyDepartment?: boolean;
  /** A short hint shown under the row label in a matrix. */
  note?: string;
  /**
   * If this resource has its own page inside a project, its link details. The
   * project screen renders a button for it — gated by `<id>:read` — so allotting
   * the module to the project's department surfaces the link automatically, with
   * no per-page list to maintain. `segment` is the path under
   * `/projects/<id>/`, e.g. "budget".
   */
  projectLink?: { segment: string; icon: LucideIcon };
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
 * The resources belonging to a given set of module ids (a department's allotted
 * `department_modules`, say). Pure registry lookup, so any matrix that renders a
 * department's grantable abilities stays data-driven: allot a module and its rows
 * appear here with zero code changes — nothing is hardcoded per department.
 */
export function resourcesForModules(moduleIds: Iterable<string>): ModuleResource[] {
  const allowed = new Set(moduleIds);
  return moduleResources().filter((r) => allowed.has(r.id));
}

/**
 * Modules that expose per-project pages, each with the resources whose link the
 * project screen should render (see `ModuleResource.projectLink`). Grouped by
 * module so the project page can show one card per module — data-driven, so a new
 * project module appears just by declaring `projectLink`, with no page edits.
 */
export function projectLinkModules(): { module: ModuleDefinition; resources: ModuleResource[] }[] {
  return modules
    .map((m) => ({ module: m, resources: (m.resources ?? []).filter((r) => r.projectLink) }))
    .filter((g) => g.resources.length > 0);
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
  procurementModule,
  inventoryModule,
  financeModule,
  pettyCashModule,
  departmentsModule,
  teamAccessModule,
  accessModule,
  auditModule,
  errorLogModule,
];

/** Modules that should appear in the sidebar, in order. */
export const navModules = modules.filter((m) => m.nav !== false);
