"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { createClient } from "@/core/supabase/server";
import { createAdminClient } from "@/core/supabase/admin";
import { requirePermission } from "@/core/rbac/can";
import { getUser } from "@/core/auth/get-user";
import { isValidEmail } from "@/modules/access/validation";
import { logAudit } from "@/modules/audit/log";
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
  await logAudit("role.create", `Created role "${trimmed}"`, { key });
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
  await logAudit("role.update", `Updated role "${trimmed}"`, { roleId });
  revalidatePath("/access");
  return ok;
}

/** Delete a role. System roles are blocked by RLS even if this is called. */
export async function deleteRole(roleId: string): Promise<ActionResult> {
  await requirePermission("access", "delete");

  const supabase = await createClient();
  const { error } = await supabase.from("roles").delete().eq("id", roleId);

  if (error) return fail(error.message);
  await logAudit("role.delete", "Deleted a role", { roleId });
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
  await logAudit(
    "permission.update",
    `${grant ? "Granted" : "Revoked"} ${resource}:${action} on a role`,
    { roleId, resource, action, grant }
  );
  revalidatePath("/access");
  return ok;
}

/** Build an absolute URL for the invite-acceptance redirect. */
async function siteOrigin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host")!;
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

/**
 * Invite a new user by email and give them an app profile + role.
 *
 * Uses the privileged admin client (the anon key can't create auth users).
 * Supabase emails an invite link; on acceptance the user lands on /auth/callback
 * and is signed in. The profile is created immediately so the person shows up in
 * the members list straight away. Upholds the invite-only model — there is still
 * no self-signup.
 */
export async function inviteUser(
  email: string,
  fullName: string,
  roleId: string | null
): Promise<ActionResult> {
  await requirePermission("access", "create");

  const cleanEmail = email.trim().toLowerCase();
  if (!isValidEmail(cleanEmail)) return fail("Enter a valid email address.");

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.inviteUserByEmail(cleanEmail, {
    redirectTo: `${await siteOrigin()}/auth/callback`,
  });

  if (error) {
    return fail(
      /already.*registered|exists/i.test(error.message)
        ? "A user with that email already exists."
        : error.message
    );
  }

  const { error: profileError } = await admin.from("profiles").upsert({
    id: data.user.id,
    email: cleanEmail,
    full_name: fullName.trim() || null,
    role_id: roleId,
  });

  if (profileError) return fail(profileError.message);
  await logAudit("user.invite", `Invited ${cleanEmail}`, {
    userId: data.user.id,
    roleId,
  });
  revalidatePath("/access");
  return ok;
}

/**
 * Permanently remove a user (their auth login and, by cascade, their profile).
 * Guards against deleting your own account by accident.
 */
export async function removeUser(userId: string): Promise<ActionResult> {
  await requirePermission("access", "delete");

  const current = await getUser();
  if (current?.id === userId) return fail("You can't remove your own account.");

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(userId);

  if (error) return fail(error.message);
  await logAudit("user.remove", "Removed a user", { userId });
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
  await logAudit(
    "user.role_change",
    roleId ? "Assigned a role to a user" : "Cleared a user's role",
    { userId, roleId }
  );
  revalidatePath("/access");
  return ok;
}
