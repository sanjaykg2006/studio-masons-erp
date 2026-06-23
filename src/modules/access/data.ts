import "server-only";

import { createClient } from "@/core/supabase/server";
import type {
  Action,
  Department,
  DepartmentModule,
  Role,
  RolePermission,
} from "@/core/rbac/types";

/** A user row for the role-assignment table. */
export type AccessUser = {
  id: string;
  email: string | null;
  full_name: string | null;
  role_id: string | null;
};

/**
 * Loads everything the Access Control page renders, in one place. All reads go
 * through the authenticated server client, so RLS (which requires access:read)
 * is the gate — these return empty for anyone not allowed.
 */
export async function getAccessData(): Promise<{
  roles: Role[];
  permissions: RolePermission[];
  users: AccessUser[];
  departments: Department[];
  departmentModules: DepartmentModule[];
  generalModules: string[];
}> {
  const supabase = await createClient();

  const [rolesRes, permsRes, usersRes, deptsRes, deptModsRes, settingsRes] =
    await Promise.all([
      supabase
        .from("roles")
        .select("id, key, label, description, is_system, department_id")
        .order("label"),
      supabase.from("role_permissions").select("role_id, resource, action"),
      supabase
        .from("profiles")
        .select("id, email, full_name, role_id")
        .order("email"),
      supabase
        .from("departments")
        .select("id, key, label, description, is_system")
        .order("label"),
      supabase.from("department_modules").select("department_id, module_id"),
      supabase.from("module_settings").select("module_id, is_general"),
    ]);

  return {
    roles: (rolesRes.data ?? []) as Role[],
    permissions: (
      (permsRes.data ?? []) as { role_id: string; resource: string; action: Action }[]
    ).map((p) => ({ role_id: p.role_id, resource: p.resource, action: p.action })),
    users: (usersRes.data ?? []) as AccessUser[],
    departments: (deptsRes.data ?? []) as Department[],
    departmentModules: (deptModsRes.data ?? []) as DepartmentModule[],
    generalModules: (
      (settingsRes.data ?? []) as { module_id: string; is_general: boolean }[]
    )
      .filter((s) => s.is_general)
      .map((s) => s.module_id),
  };
}
