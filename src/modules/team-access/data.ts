import "server-only";

import { createClient } from "@/core/supabase/server";
import type { Action, Department, DepartmentModule } from "@/core/rbac/types";
import type { AccessUser } from "@/modules/access/data";

/** A person on a department's team. */
export type TeamMember = {
  department_id: string;
  user_id: string;
  /** Works across every project in the department, via all_projects_role_id. */
  all_projects: boolean;
  /** The project role applied on all projects when all_projects is on. */
  all_projects_role_id: string | null;
};

/** A project role in a department, for the "sees all projects" picker. */
export type TeamRole = { id: string; label: string; department_id: string | null };

/** One per-user grant within a department. */
export type TeamGrant = {
  department_id: string;
  user_id: string;
  resource: string;
  action: Action;
};

export type TeamAccessData = {
  departments: Department[];
  departmentModules: DepartmentModule[];
  /** Who is on each led department's team. */
  members: TeamMember[];
  /** Each member's ticked permissions. */
  grants: TeamGrant[];
  /** Everyone (for the "add a person" picker and name lookups). */
  people: AccessUser[];
  /** The led departments' project roles, for the "sees all projects" picker. */
  roles: TeamRole[];
  generalModules: string[];
};

/**
 * Loads everything a department lead's Team Access page renders, scoped to the
 * departments they lead. Reads go through the authenticated client; RLS only
 * returns a lead their own department's team rows and grants, so this is scoped
 * both by the explicit `deptIds` filter AND by the database.
 */
export async function getTeamAccessData(
  deptIds: string[]
): Promise<TeamAccessData> {
  const empty: TeamAccessData = {
    departments: [],
    departmentModules: [],
    members: [],
    grants: [],
    people: [],
    roles: [],
    generalModules: [],
  };
  if (deptIds.length === 0) return empty;

  const supabase = await createClient();
  const [
    deptsRes,
    deptModsRes,
    membersRes,
    grantsRes,
    peopleRes,
    rolesRes,
    settingsRes,
  ] = await Promise.all([
    supabase
      .from("departments")
      .select("id, key, label, description, is_system")
      .in("id", deptIds)
      .order("label"),
    supabase
      .from("department_modules")
      .select("department_id, module_id")
      .in("department_id", deptIds),
    supabase
      .from("team_members")
      .select("department_id, user_id, all_projects, all_projects_role_id")
      .in("department_id", deptIds),
    supabase
      .from("team_member_permissions")
      .select("department_id, user_id, resource, action")
      .in("department_id", deptIds),
    supabase
      .from("profiles")
      .select("id, email, full_name, role_id")
      .order("email"),
    supabase
      .from("roles")
      .select("id, label, department_id")
      .in("department_id", deptIds)
      .order("label"),
    supabase.from("module_settings").select("module_id, is_general"),
  ]);

  return {
    departments: (deptsRes.data ?? []) as Department[],
    departmentModules: (deptModsRes.data ?? []) as DepartmentModule[],
    members: (membersRes.data ?? []) as TeamMember[],
    grants: (grantsRes.data ?? []) as TeamGrant[],
    people: (peopleRes.data ?? []) as AccessUser[],
    roles: (rolesRes.data ?? []) as TeamRole[],
    generalModules: (
      (settingsRes.data ?? []) as { module_id: string; is_general: boolean }[]
    )
      .filter((s) => s.is_general)
      .map((s) => s.module_id),
  };
}
