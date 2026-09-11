import "server-only";

import { createClient } from "@/core/supabase/server";
import { moduleResources } from "@/core/modules/registry";
import type { AccessUser } from "@/modules/access/data";
import type { AccessResource } from "@/modules/access/components/permission-matrix";
import type { TeamGrant, TeamMember, TeamRole } from "@/modules/team-access/data";
import { getDepartment, type MyDepartment } from "@/modules/departments/data";

export type SubteamRef = { id: string; key: string; label: string; sort: number };
export type SubteamMembership = { subteam_id: string; user_id: string };

export type DepartmentPeopleData = {
  department: MyDepartment;
  members: TeamMember[];
  grants: TeamGrant[];
  people: AccessUser[];
  roles: TeamRole[];
  /** What a person can do inside the department (tasks, settings, its tools). */
  resources: AccessResource[];
  subteams: SubteamRef[];
  subteamMembers: SubteamMembership[];
};

/**
 * Everything the unified "People & Access" screen needs for ONE department:
 * its team, each person's abilities + all-projects role, and the sub-team grid.
 * Returns null unless the caller may run this department's people (its lead, HR,
 * or someone given People & Access) — the database is the real boundary.
 */
export async function getDepartmentPeopleData(
  deptId: string
): Promise<DepartmentPeopleData | null> {
  const department = await getDepartment(deptId);
  if (!department || !department.can_manage_people) return null;

  const supabase = await createClient();
  const [
    membersRes,
    grantsRes,
    peopleRes,
    rolesRes,
    subteamsRes,
    subMembersRes,
    deptModsRes,
  ] = await Promise.all([
    supabase
      .from("team_members")
      .select("department_id, user_id, all_projects, all_projects_role_id")
      .eq("department_id", deptId),
    supabase
      .from("team_member_permissions")
      .select("department_id, user_id, resource, action")
      .eq("department_id", deptId),
    supabase
      .from("profiles")
      .select("id, email, full_name, role_id")
      .order("email"),
    supabase
      .from("roles")
      .select("id, label, department_id")
      .eq("department_id", deptId)
      .order("rank", { ascending: true })
      .order("label"),
    supabase.rpc("list_department_subteams", { p_dept: deptId }),
    supabase.rpc("list_subteam_members", { p_dept: deptId }),
    supabase.from("department_modules").select("module_id").eq("department_id", deptId),
  ]);

  // Only the department's own work belongs here: the abilities every department
  // has (tasks, settings, people) first, then the department-level tools it was
  // allotted. Company-wide screens are given with the job title (Access
  // Control) and project work per project role (Settings), so neither shows.
  const allotted = new Set(
    ((deptModsRes.data ?? []) as { module_id: string }[]).map((m) => m.module_id)
  );

  return {
    department,
    members: (membersRes.data ?? []) as TeamMember[],
    grants: (grantsRes.data ?? []) as TeamGrant[],
    people: (peopleRes.data ?? []) as AccessUser[],
    roles: (rolesRes.data ?? []) as TeamRole[],
    // Plain {id,label,actions} — the registry rows also carry a projectLink icon
    // (a component) that can't cross into the client PeopleAccessView.
    resources: moduleResources()
      .filter((r) => r.departmentLevel && (r.everyDepartment || allotted.has(r.id)))
      .sort((a, b) => Number(Boolean(b.everyDepartment)) - Number(Boolean(a.everyDepartment)))
      .map((r) => ({ id: r.id, label: r.label, actions: r.actions })),
    subteams: (subteamsRes.data ?? []) as SubteamRef[],
    subteamMembers: (subMembersRes.data ?? []) as SubteamMembership[],
  };
}
