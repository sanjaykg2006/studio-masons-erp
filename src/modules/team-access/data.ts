import "server-only";

import { createClient } from "@/core/supabase/server";
import type {
  Action,
  Department,
  DepartmentModule,
  Role,
  RolePermission,
} from "@/core/rbac/types";
import type { AccessUser } from "@/modules/access/data";

export type TeamAccessData = {
  departments: Department[];
  roles: Role[];
  permissions: RolePermission[];
  departmentModules: DepartmentModule[];
  members: AccessUser[];
  generalModules: string[];
};

/**
 * Loads everything a department lead's Team Access page renders, scoped to the
 * departments they lead. All reads go through the authenticated client; RLS only
 * returns a lead their own department's roles/grants/modules, so this is scoped
 * both by the explicit `deptIds` filter AND by the database. General modules are
 * loaded so the matrix can mark them (they are not lead-editable here).
 */
export async function getTeamAccessData(
  deptIds: string[]
): Promise<TeamAccessData> {
  const supabase = await createClient();

  if (deptIds.length === 0) {
    return {
      departments: [],
      roles: [],
      permissions: [],
      departmentModules: [],
      members: [],
      generalModules: [],
    };
  }

  const [deptsRes, rolesRes, deptModsRes, membersRes, settingsRes] =
    await Promise.all([
      supabase
        .from("departments")
        .select("id, key, label, description, is_system")
        .in("id", deptIds)
        .order("label"),
      supabase
        .from("roles")
        .select(
          "id, key, label, description, is_system, department_id, is_department_wide"
        )
        .in("department_id", deptIds)
        .order("label"),
      supabase
        .from("department_modules")
        .select("department_id, module_id")
        .in("department_id", deptIds),
      supabase
        .from("profiles")
        .select("id, email, full_name, role_id")
        .order("email"),
      supabase.from("module_settings").select("module_id, is_general"),
    ]);

  const roles = (rolesRes.data ?? []) as Role[];
  const roleIds = roles.map((r) => r.id);

  // Grants only for the in-scope roles (RLS already restricts, this keeps it tight).
  const permsRes = roleIds.length
    ? await supabase
        .from("role_permissions")
        .select("role_id, resource, action")
        .in("role_id", roleIds)
    : { data: [] as { role_id: string; resource: string; action: Action }[] };

  return {
    departments: (deptsRes.data ?? []) as Department[],
    roles,
    permissions: (
      (permsRes.data ?? []) as {
        role_id: string;
        resource: string;
        action: Action;
      }[]
    ).map((p) => ({ role_id: p.role_id, resource: p.resource, action: p.action })),
    departmentModules: (deptModsRes.data ?? []) as DepartmentModule[],
    members: (membersRes.data ?? []) as AccessUser[],
    generalModules: (
      (settingsRes.data ?? []) as { module_id: string; is_general: boolean }[]
    )
      .filter((s) => s.is_general)
      .map((s) => s.module_id),
  };
}
