"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/core/supabase/server";
import { requirePermission } from "@/core/rbac/can";
import type { Action } from "@/core/rbac/types";

/** Uniform result for the Access Control forms. */
export type ActionResult = { ok: true } | { ok: false; error: string };

/** Turn a label into a stable, url-safe role key, e.g. "Project Manager" -> "project_manager". */
function toKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const ok: ActionResult = { ok: true };
const fail = (error: string): ActionResult => ({ ok: false, error });

/** Create a new (non-system) role. */
export async function createRole(label: string): Promise<ActionResult> {
  await requirePermission("access", "create");
  const trimmed = label.trim();
  const key = toKey(trimmed);
  if (!trimmed || !key) return fail("Enter a role name.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("roles")
    .insert({ key, label: trimmed });

  if (error) {
    return fail(
      error.code === "23505" ? "A role with that name already exists." : error.message
    );
  }
  revalidatePath("/access");
  return ok;
}

/** Rename / re-describe a role. The stable `key` is never changed. */
export async function updateRole(
  roleId: string,
  label: string,
  description: string | null
): Promise<ActionResult> {
  await requirePermission("access", "update");
  const trimmed = label.trim();
  if (!trimmed) return fail("Enter a role name.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("roles")
    .update({ label: trimmed, description: description?.trim() || null })
    .eq("id", roleId);

  if (error) return fail(error.message);
  revalidatePath("/access");
  return ok;
}

/** Delete a role. System roles are blocked by RLS even if this is called. */
export async function deleteRole(roleId: string): Promise<ActionResult> {
  await requirePermission("access", "delete");

  const supabase = await createClient();
  const { error } = await supabase.from("roles").delete().eq("id", roleId);

  if (error) return fail(error.message);
  revalidatePath("/access");
  return ok;
}

/**
 * Grant or revoke a single (resource, action) on a role — one matrix cell.
 * Granting inserts the row; revoking deletes it (deny-by-default).
 */
export async function setPermission(
  roleId: string,
  resource: string,
  action: Action,
  grant: boolean
): Promise<ActionResult> {
  await requirePermission("access", "update");

  const supabase = await createClient();
  const { error } = grant
    ? await supabase
        .from("role_permissions")
        .upsert({ role_id: roleId, resource, action })
    : await supabase
        .from("role_permissions")
        .delete()
        .match({ role_id: roleId, resource, action });

  if (error) return fail(error.message);
  revalidatePath("/access");
  return ok;
}

/** Assign a user's single role (or clear it with null). */
export async function assignUserRole(
  userId: string,
  roleId: string | null
): Promise<ActionResult> {
  await requirePermission("access", "update");

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ role_id: roleId })
    .eq("id", userId);

  if (error) return fail(error.message);
  revalidatePath("/access");
  return ok;
}
