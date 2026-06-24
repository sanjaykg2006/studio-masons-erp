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
 * Grant or revoke one (resource, action) on a department role — one matrix cell.
 * The lead writes role_permissions directly; RLS (lead_can_grant) is the real
 * boundary: it only permits non-general modules belonging to a department the
 * caller leads. A blocked write surfaces as an inline error.
 */
export async function setTeamPermission(
  roleId: string,
  resource: string,
  action: Action,
  grant: boolean
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = grant
    ? await supabase
        .from("role_permissions")
        .upsert({ role_id: roleId, resource, action })
    : await supabase
        .from("role_permissions")
        .delete()
        .match({ role_id: roleId, resource, action });

  if (error) {
    return fail(
      /row-level security|violates|not authorized/i.test(error.message)
        ? "You can only manage your own department's modules."
        : error.message
    );
  }
  await logAudit(
    "permission.update",
    `${grant ? "Granted" : "Revoked"} ${resource}:${action} on a department role`,
    { roleId, resource, action, grant }
  );
  revalidatePath("/team");
  return ok;
}

/**
 * Flag a department role department-wide (sees every project in scope) or
 * project-scoped (reaches a project only via membership). Backed by the
 * set_role_department_wide RPC, which re-checks the caller leads the role's dept.
 */
export async function setTeamRoleWide(
  roleId: string,
  isWide: boolean
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_role_department_wide", {
    p_role: roleId,
    p_wide: isWide,
  });
  if (error) return fail(error.message);
  await logAudit(
    "role.scope",
    `Set a department role ${isWide ? "department-wide" : "project-scoped"}`,
    { roleId, isWide }
  );
  revalidatePath("/team");
  return ok;
}

/**
 * Assign a person into one of this department's roles. Backed by the
 * set_member_department_role RPC, which re-checks the caller leads that role's
 * department before changing the profile.
 */
export async function assignTeamMember(
  userId: string,
  roleId: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_member_department_role", {
    p_user: userId,
    p_role: roleId,
  });
  if (error) return fail(error.message);
  await logAudit("user.role_change", "Assigned a department role to a user", {
    userId,
    roleId,
  });
  revalidatePath("/team");
  return ok;
}

/**
 * Remove a person from this department (clears their role, only if it currently
 * sits in a department the caller leads). Backed by clear_member_department_role.
 */
export async function removeTeamMember(userId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("clear_member_department_role", {
    p_user: userId,
  });
  if (error) return fail(error.message);
  await logAudit("user.role_change", "Removed a user from a department", {
    userId,
  });
  revalidatePath("/team");
  return ok;
}
