"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/core/supabase/server";
import { logAudit } from "@/modules/audit/log";
import type { Action } from "@/core/rbac/types";

/** Uniform result for the Team Access forms. */
export type ActionResult = { ok: true } | { ok: false; error: string };

const ok: ActionResult = { ok: true };
const fail = (error: string): ActionResult => ({ ok: false, error });

/**
 * Add a person to a department's team. Backed by the add_team_member RPC, which
 * re-checks the caller leads (or admins) the department. They start with no
 * permissions until the lead ticks some.
 */
export async function addTeamMember(
  departmentId: string,
  userId: string
): Promise<ActionResult> {
  if (!departmentId || !userId) return fail("Pick a person.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_team_member", {
    p_dept: departmentId,
    p_user: userId,
  });
  if (error) return fail(error.message);
  await logAudit("team.member.add", "Added a person to a department team", {
    departmentId,
    userId,
  });
  revalidatePath("/team");
  return ok;
}

/**
 * Remove a person from a department's team (also clears their grants there).
 * Backed by remove_team_member, which re-checks the caller leads the department.
 */
export async function removeTeamMember(
  departmentId: string,
  userId: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_team_member", {
    p_dept: departmentId,
    p_user: userId,
  });
  if (error) return fail(error.message);
  await logAudit("team.member.remove", "Removed a person from a department team", {
    departmentId,
    userId,
  });
  revalidatePath("/team");
  return ok;
}

/**
 * Tick or untick one (resource, action) for a person in a department — one cell
 * of the per-person grid. Backed by set_team_member_permission, which validates
 * the module belongs to the department and the caller leads it.
 */
export async function setTeamMemberPermission(
  departmentId: string,
  userId: string,
  resource: string,
  action: Action,
  grant: boolean
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_team_member_permission", {
    p_dept: departmentId,
    p_user: userId,
    p_resource: resource,
    p_action: action,
    p_grant: grant,
  });
  if (error) return fail(error.message);
  await logAudit(
    "team.permission.update",
    `${grant ? "Granted" : "Revoked"} ${resource}:${action} for a teammate`,
    { departmentId, userId, resource, action, grant }
  );
  revalidatePath("/team");
  return ok;
}

/**
 * Turn "works on all projects" on or off for a teammate, with the single project
 * role that then applies to them on every project (and drives their folder access
 * through the role-based matrix). Backed by set_team_member_all_projects.
 */
export async function setTeamMemberAllProjects(
  departmentId: string,
  userId: string,
  allProjects: boolean,
  roleId: string | null
): Promise<ActionResult> {
  if (allProjects && !roleId) return fail("Pick a project role.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_team_member_all_projects", {
    p_dept: departmentId,
    p_user: userId,
    p_all: allProjects,
    p_role: roleId,
  });
  if (error) return fail(error.message);
  await logAudit(
    "team.all_projects",
    `${allProjects ? "Enabled" : "Disabled"} all-projects access for a teammate`,
    { departmentId, userId, roleId }
  );
  revalidatePath("/team");
  return ok;
}
