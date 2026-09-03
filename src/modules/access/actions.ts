"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { createClient } from "@/core/supabase/server";
import { createAdminClient } from "@/core/supabase/admin";
import { env } from "@/core/config/env";
import { authorize } from "@/core/rbac/can";
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

/**
 * Create a new (non-system) role, optionally under a department. A role with a
 * department can only be granted that department's modules + general ones (the
 * DB guard enforces this); a department-less role is a global role.
 */
export async function createRole(
  label: string,
  departmentId: string | null = null
): Promise<ActionResult> {
  const denied = await authorize("access", "create");
  if (denied) return denied;
  const trimmed = label.trim();
  const key = toKey(trimmed);
  if (!trimmed || !key) return fail("Enter a role name.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("roles")
    .insert({ key, label: trimmed, department_id: departmentId });

  if (error) {
    return fail(
      error.code === "23505" ? "A role with that name already exists." : error.message
    );
  }
  await logAudit("role.create", `Created role "${trimmed}"`, {
    key,
    departmentId,
  });
  revalidatePath("/access");
  return ok;
}

/** Rename / re-describe a role. The stable `key` is never changed. */
export async function updateRole(
  roleId: string,
  label: string,
  description: string | null
): Promise<ActionResult> {
  const denied = await authorize("access", "update");
  if (denied) return denied;
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
  const denied = await authorize("access", "delete");
  if (denied) return denied;

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
  const denied = await authorize("access", "update");
  if (denied) return denied;

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
  if (env.NEXT_PUBLIC_SITE_URL) return env.NEXT_PUBLIC_SITE_URL;
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
  const denied = await authorize("access", "create");
  if (denied) return denied;

  const cleanEmail = email.trim().toLowerCase();
  if (!isValidEmail(cleanEmail)) return fail("Enter a valid email address.");

  const admin = createAdminClient();
  // `next` pins the destination even when the link comes back as a `?code=`
  // exchange (which carries no `type=invite` for the callback to read). An
  // invited account has no password yet, so choosing one is the first stop.
  const { data, error } = await admin.auth.admin.inviteUserByEmail(cleanEmail, {
    redirectTo: `${await siteOrigin()}/auth/callback?next=/set-password`,
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
 * Remove a person from the ERP.
 *
 * Every action in the app records who did it, so a user who has done anything
 * cannot be hard-deleted without destroying that history — the database blocks
 * it. So we try a clean delete first (this only succeeds for an account that is
 * referenced nowhere, e.g. a mistyped invite that never did a thing); if the
 * database refuses, we DEACTIVATE instead: block their login and flag the
 * profile, keeping all their past work intact and correctly attributed.
 * Reversible via reactivateUser.
 */
export async function deactivateUser(userId: string): Promise<ActionResult> {
  const denied = await authorize("access", "delete");
  if (denied) return denied;

  const current = await getUser();
  if (current?.id === userId) return fail("You can't remove your own account.");

  const admin = createAdminClient();

  // Try a clean delete for a never-used account. The audit-trail foreign keys
  // block this for anyone with history — which is exactly the protection we want.
  const { error: delErr } = await admin.auth.admin.deleteUser(userId);
  if (!delErr) {
    await logAudit("user.remove", "Removed a user", { userId });
    revalidatePath("/access");
    return ok;
  }

  // They have history: deactivate instead. Ban the login for ~100 years
  // (effectively permanent, but reversible) and stamp the profile.
  const { error: banErr } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: "876000h",
  });
  if (banErr) return fail(banErr.message);

  const { error: flagErr } = await admin
    .from("profiles")
    .update({ deactivated_at: new Date().toISOString() })
    .eq("id", userId);
  if (flagErr) return fail(flagErr.message);

  await logAudit("user.deactivate", "Deactivated a user", { userId });
  revalidatePath("/access");
  return ok;
}

/** Switch a deactivated user back on: lift the login ban and clear the flag. */
export async function reactivateUser(userId: string): Promise<ActionResult> {
  const denied = await authorize("access", "update");
  if (denied) return denied;

  const admin = createAdminClient();

  const { error: unbanErr } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: "none",
  });
  if (unbanErr) return fail(unbanErr.message);

  const { error: flagErr } = await admin
    .from("profiles")
    .update({ deactivated_at: null })
    .eq("id", userId);
  if (flagErr) return fail(flagErr.message);

  await logAudit("user.reactivate", "Reactivated a user", { userId });
  revalidatePath("/access");
  return ok;
}

/** Assign a user's single role (or clear it with null). */
export async function assignUserRole(
  userId: string,
  roleId: string | null
): Promise<ActionResult> {
  const denied = await authorize("access", "update");
  if (denied) return denied;

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

// --- Departments -----------------------------------------------------------

/** Create a department (a named group that owns a set of modules). */
export async function createDepartment(label: string): Promise<ActionResult> {
  const denied = await authorize("access", "create");
  if (denied) return denied;
  const trimmed = label.trim();
  const key = toKey(trimmed);
  if (!trimmed || !key) return fail("Enter a department name.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("departments")
    .insert({ key, label: trimmed });

  if (error) {
    return fail(
      error.code === "23505"
        ? "A department with that name already exists."
        : error.message
    );
  }
  await logAudit("department.create", `Created department "${trimmed}"`, { key });
  revalidatePath("/access");
  return ok;
}

/** Rename / re-describe a department. The stable `key` is never changed. */
export async function updateDepartment(
  departmentId: string,
  label: string,
  description: string | null
): Promise<ActionResult> {
  const denied = await authorize("access", "update");
  if (denied) return denied;
  const trimmed = label.trim();
  if (!trimmed) return fail("Enter a department name.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("departments")
    .update({ label: trimmed, description: description?.trim() || null })
    .eq("id", departmentId);

  if (error) return fail(error.message);
  await logAudit("department.update", `Updated department "${trimmed}"`, {
    departmentId,
  });
  revalidatePath("/access");
  return ok;
}

/**
 * Delete a department. Refused if any role still lives under it — reassign or
 * delete those roles first so no one is silently orphaned.
 */
export async function deleteDepartment(
  departmentId: string
): Promise<ActionResult> {
  const denied = await authorize("access", "delete");
  if (denied) return denied;

  const supabase = await createClient();
  const { count, error: countError } = await supabase
    .from("roles")
    .select("id", { count: "exact", head: true })
    .eq("department_id", departmentId);

  if (countError) return fail(countError.message);
  if ((count ?? 0) > 0) {
    return fail(
      "This department still has roles. Delete or move them before removing it."
    );
  }

  const { error } = await supabase
    .from("departments")
    .delete()
    .eq("id", departmentId);

  if (error) return fail(error.message);
  await logAudit("department.delete", "Deleted a department", { departmentId });
  revalidatePath("/access");
  return ok;
}

/**
 * Add or remove a module from a department. Removing also revokes any grants
 * roles in that department held on the module, so no hidden permissions linger.
 */
export async function setDepartmentModule(
  departmentId: string,
  moduleId: string,
  include: boolean
): Promise<ActionResult> {
  const denied = await authorize("access", "update");
  if (denied) return denied;

  const supabase = await createClient();

  if (include) {
    const { error } = await supabase
      .from("department_modules")
      .upsert({ department_id: departmentId, module_id: moduleId });
    if (error) return fail(error.message);
  } else {
    // Revoke grants on this module for every role in the department first.
    const { data: deptRoles, error: rolesError } = await supabase
      .from("roles")
      .select("id")
      .eq("department_id", departmentId);
    if (rolesError) return fail(rolesError.message);

    const roleIds = (deptRoles ?? []).map((r) => r.id);
    if (roleIds.length > 0) {
      const { error: permError } = await supabase
        .from("role_permissions")
        .delete()
        .eq("resource", moduleId)
        .in("role_id", roleIds);
      if (permError) return fail(permError.message);
    }

    const { error } = await supabase
      .from("department_modules")
      .delete()
      .match({ department_id: departmentId, module_id: moduleId });
    if (error) return fail(error.message);
  }

  await logAudit(
    "department.module",
    `${include ? "Added" : "Removed"} module "${moduleId}" ${
      include ? "to" : "from"
    } a department`,
    { departmentId, moduleId, include }
  );
  revalidatePath("/access");
  return ok;
}

/** Flag (or unflag) a module as "general" — shown in every role's matrix. */
export async function setModuleGeneral(
  moduleId: string,
  isGeneral: boolean
): Promise<ActionResult> {
  const denied = await authorize("access", "update");
  if (denied) return denied;

  const supabase = await createClient();
  const { error } = await supabase
    .from("module_settings")
    .upsert({ module_id: moduleId, is_general: isGeneral });

  if (error) return fail(error.message);
  await logAudit(
    "module.general",
    `${isGeneral ? "Marked" : "Unmarked"} module "${moduleId}" as general`,
    { moduleId, isGeneral }
  );
  revalidatePath("/access");
  return ok;
}

/**
 * Appoint (or remove) a user as the lead of a department. The lead manages that
 * department's role permissions and team on the department's own Team Access
 * page — never another department's or the global config.
 */
export async function setDepartmentLead(
  departmentId: string,
  userId: string,
  isLead: boolean
): Promise<ActionResult> {
  const denied = await authorize("access", "update");
  if (denied) return denied;

  const supabase = await createClient();
  const { error } = isLead
    ? await supabase
        .from("department_leads")
        .upsert({ department_id: departmentId, user_id: userId })
    : await supabase
        .from("department_leads")
        .delete()
        .match({ department_id: departmentId, user_id: userId });

  if (error) return fail(error.message);
  await logAudit(
    "department.lead",
    `${isLead ? "Appointed" : "Removed"} a department lead`,
    { departmentId, userId, isLead }
  );
  revalidatePath("/access");
  return ok;
}
