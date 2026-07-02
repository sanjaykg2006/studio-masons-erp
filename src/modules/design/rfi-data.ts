import "server-only";

import { createClient } from "@/core/supabase/server";
import type { DepartmentRef, RfiRow, RoleRef } from "@/modules/design/rfi-types";

export type ProjectRfis = {
  rfis: RfiRow[];
  departments: DepartmentRef[];
  /** Each department's roles (most senior first), for the "send to" picker. */
  rolesByDept: Record<string, RoleRef[]>;
};

type LadderRow = { department_id: string; id: string; label: string; rank: number };

/** The RFIs on a project the caller can see, plus the department list for the
 * "ask a department" picker and each department's role ladder. */
export async function getProjectRfis(projectId: string): Promise<ProjectRfis> {
  const supabase = await createClient();
  const [rfisRes, deptsRes, rolesRes] = await Promise.all([
    supabase.rpc("list_project_rfis", { p_project: projectId }),
    supabase.rpc("list_active_departments"),
    supabase.rpc("list_department_roles"),
  ]);

  const rolesByDept: Record<string, RoleRef[]> = {};
  for (const r of (rolesRes.data ?? []) as LadderRow[]) {
    (rolesByDept[r.department_id] ??= []).push({ id: r.id, label: r.label, rank: r.rank });
  }

  return {
    rfis: (rfisRes.data ?? []) as RfiRow[],
    departments: (deptsRes.data ?? []) as DepartmentRef[],
    rolesByDept,
  };
}
