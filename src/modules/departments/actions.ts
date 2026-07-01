"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/core/supabase/server";

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
