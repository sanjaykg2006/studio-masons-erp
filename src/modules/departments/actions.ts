"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/core/supabase/server";
import type { FolderCapability } from "@/modules/design/types";

export type ActionResult = { ok: true } | { ok: false; error: string };
const ok: ActionResult = { ok: true };
const fail = (error: string): ActionResult => ({ ok: false, error });

const refresh = (deptId: string) => revalidatePath(`/departments/${deptId}/settings`);

/** Create a project role in a department. (deptId is bound per page.) */
export async function createDeptRole(deptId: string, label: string): Promise<ActionResult> {
  if (!label.trim()) return fail("Enter a role name.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_department_role", {
    p_dept: deptId,
    p_label: label,
  });
  if (error) return fail(error.message);
  refresh(deptId);
  return ok;
}

export async function deleteDeptRole(deptId: string, roleId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_department_role", { p_role: roleId });
  if (error) return fail(error.message);
  refresh(deptId);
  return ok;
}

export async function moveDeptRole(
  deptId: string,
  roleId: string,
  up: boolean
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("move_department_role", { p_role: roleId, p_up: up });
  if (error) return fail(error.message);
  refresh(deptId);
  return ok;
}

export async function setDeptRolePermission(
  deptId: string,
  roleId: string,
  resource: string,
  action: string,
  grant: boolean
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_department_role_permission", {
    p_role: roleId,
    p_resource: resource,
    p_action: action,
    p_grant: grant,
  });
  if (error) return fail(error.message);
  refresh(deptId);
  return ok;
}

/** Set (or clear, when capability is null) a department role's capability on a
 *  controlled folder. The RPC re-checks the caller manages the department and
 *  that the department actually holds the Controlled Folder Access module. */
export async function setDeptFolderAccess(
  deptId: string,
  folderKey: string,
  roleId: string,
  capability: FolderCapability | null
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_department_folder_access", {
    p_dept: deptId,
    p_folder: folderKey,
    p_role: roleId,
    p_capability: capability,
  });
  if (error) return fail(error.message);
  refresh(deptId);
  return ok;
}

/** Put a person into (or out of) one of a department's sub-teams, e.g. Design's
 *  Concept / Technical. The RPC re-checks the caller manages the team. */
export async function setSubteamMember(
  deptId: string,
  subteamId: string,
  userId: string,
  grant: boolean
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_subteam_member", {
    p_subteam: subteamId,
    p_user: userId,
    p_grant: grant,
  });
  if (error) return fail(error.message);
  revalidatePath(`/departments/${deptId}/people`);
  return ok;
}
