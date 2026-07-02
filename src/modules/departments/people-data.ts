import "server-only";

import { createClient } from "@/core/supabase/server";
import { resourcesForModules } from "@/core/modules/registry";
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
  /** Department-level abilities (create projects, manage templates, …). */
  resources: AccessResource[];
  subteams: SubteamRef[];
  subteamMembers: SubteamMembership[];
};

/**
 * Everything the unified "People & Access" screen needs for ONE department:
 * its team, each person's abilities + all-projects role, and the sub-team grid.
 * Returns null unless the caller may manage this department (lead or admin) —
 * the database (RLS + the RPCs) is the real boundary on every write.
 */
export async function getDepartmentPeopleData(
  deptId: string
): Promise<DepartmentPeopleData | null> {
  const department = await getDepartment(deptId);
  if (!department || !department.can_manage) return null;

  const supabase = await createClient();
  const [
    membersRes,
    grantsRes,
    peopleRes,
    rolesRes,
    subteamsRes,
    subMembersRes,
    deptModsRes,
    settingsRes,
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
    supabase.from("module_settings").select("module_id, is_general"),
  ]);

  // Only this department's own modules (plus any marked general) belong on its
  // matrix — otherwise every department would list every other one's abilities
  // (e.g. Procurement · Vendors showing under Design). Of those, the "Extra
  // abilities" grid shows only the department-level ones; project-level modules
  // are granted per role on the settings page, not per person here.
  const deptModuleIds = new Set<string>([
    ...((deptModsRes.data ?? []) as { module_id: string }[]).map((m) => m.module_id),
    ...((settingsRes.data ?? []) as { module_id: string; is_general: boolean }[])
      .filter((s) => s.is_general)
      .map((s) => s.module_id),
  ]);

  return {
    department,
    members: (membersRes.data ?? []) as TeamMember[],
    grants: (grantsRes.data ?? []) as TeamGrant[],
    people: (peopleRes.data ?? []) as AccessUser[],
    roles: (rolesRes.data ?? []) as TeamRole[],
    resources: resourcesForModules(deptModuleIds).filter((r) => r.departmentLevel),
    subteams: (subteamsRes.data ?? []) as SubteamRef[],
    subteamMembers: (subMembersRes.data ?? []) as SubteamMembership[],
  };
}
