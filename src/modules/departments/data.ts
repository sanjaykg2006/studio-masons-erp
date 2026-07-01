import "server-only";

import { createClient } from "@/core/supabase/server";
import type { Action } from "@/core/rbac/types";
import type { ProjectRoleRow } from "@/modules/design/data";

export type MyDepartment = {
  id: string;
  key: string;
  label: string;
  is_lead: boolean;
  can_manage: boolean;
};

/** The departments the caller belongs to (team member, lead, or admin). */
export async function getMyDepartments(): Promise<MyDepartment[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_departments");
  return (data ?? []) as MyDepartment[];
}

/** One department's summary (or null if the caller can't see it). */
export async function getDepartment(deptId: string): Promise<MyDepartment | null> {
  const mine = await getMyDepartments();
  return mine.find((d) => d.id === deptId) ?? null;
}

export type DepartmentRolesConfig = {
  roles: ProjectRoleRow[];
  permissions: { role_id: string; resource: string; action: Action }[];
};

/** A department's project roles + their grants, for the settings matrix. */
export async function getDepartmentRolesConfig(
  deptId: string
): Promise<DepartmentRolesConfig> {
  const supabase = await createClient();
  const [rolesRes, permsRes] = await Promise.all([
    supabase.rpc("department_roles", { p_dept: deptId }),
    supabase.rpc("department_role_permissions", { p_dept: deptId }),
  ]);
  return {
    roles: (rolesRes.data ?? []) as ProjectRoleRow[],
    permissions: (permsRes.data ?? []) as {
      role_id: string;
      resource: string;
      action: Action;
    }[],
  };
}
