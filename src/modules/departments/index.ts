import { Building2 } from "lucide-react";

import type { ModuleDefinition } from "@/core/modules/registry";

/**
 * Departments hub — a per-department workspace (task board + roles settings) for
 * every department the user belongs to. Its sidebar link is gated by a synthetic
 * "department.workspace:read" hint injected in the (app) layout when the user is
 * on any department's team or leads one. The real boundary is each RPC's own
 * department check.
 *
 * Its resources are the abilities EVERY department has without allotting a
 * module. The lead holds them automatically; People & Access ticks them for
 * others (is_department_ability / can_create_task / can_manage_department_roles /
 * can_manage_team in 0078).
 */
export const departmentsModule: ModuleDefinition = {
  id: "departments",
  label: "Departments",
  href: "/departments",
  icon: Building2,
  nav: true,
  requires: { resource: "department.workspace", action: "read" },
  resources: [
    {
      id: "department.tasks",
      label: "Tasks",
      // create = set tasks · update = edit or pause anyone's task · delete = remove any task
      actions: ["create", "update", "delete"],
      departmentLevel: true,
      everyDepartment: true,
    },
    {
      id: "department.settings",
      label: "Settings",
      // Project roles, their permissions and folder access.
      actions: ["manage"],
      departmentLevel: true,
      everyDepartment: true,
    },
    {
      id: "department.people",
      label: "People & Access",
      // Add/remove teammates, sub-teams, every-project role and these ticks.
      actions: ["manage"],
      departmentLevel: true,
      everyDepartment: true,
    },
  ],
};
