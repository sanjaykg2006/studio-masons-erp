import "server-only";

import { createClient } from "@/core/supabase/server";
import type { DepartmentRef, RfiRow } from "@/modules/design/rfi-types";

export type ProjectRfis = {
  rfis: RfiRow[];
  departments: DepartmentRef[];
};

/** The RFIs on a project the caller can see, plus the department list for the
 * "ask a department" picker. */
export async function getProjectRfis(projectId: string): Promise<ProjectRfis> {
  const supabase = await createClient();
  const [rfisRes, deptsRes] = await Promise.all([
    supabase.rpc("list_project_rfis", { p_project: projectId }),
    supabase.rpc("list_active_departments"),
  ]);
  return {
    rfis: (rfisRes.data ?? []) as RfiRow[],
    departments: (deptsRes.data ?? []) as DepartmentRef[],
  };
}
