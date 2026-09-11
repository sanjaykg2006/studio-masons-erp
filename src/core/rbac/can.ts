import { redirect } from "next/navigation";

import { createClient } from "@/core/supabase/server";
import { can, canAnywhere, getPermissions } from "@/core/rbac/permissions";
import { permissionMessage, type Action, type Resource } from "@/core/rbac/types";

export { can, canAnywhere, getPermissions };

/**
 * Page guard. If the user lacks `action` on `resource`, send them to the
 * /forbidden screen (which explains what they lack) instead of silently
 * bouncing to the dashboard. Use this at the top of protected pages.
 *
 * Do NOT use this inside server actions — a redirect mid-click is jarring.
 * Use `authorize()` there and return its result so the UI shows a message.
 *
 * Convenience layer only — the real boundary is RLS in the database.
 */
export async function requirePermission(
  resource: Resource,
  action: Action
): Promise<void> {
  if (!(await can(resource, action))) {
    redirect(`/forbidden?resource=${encodeURIComponent(resource)}&action=${action}`);
  }
}

/**
 * Server-action guard. Returns a failed ActionResult with a readable message
 * when the user can't `action` the `resource`, or null when they're allowed —
 * so callers can `return denied` and surface it inline (no redirect).
 */
export async function authorize(
  resource: Resource,
  action: Action
): Promise<{ ok: false; error: string } | null> {
  if (await can(resource, action)) return null;
  return { ok: false, error: permissionMessage(resource, action) };
}

/** Page guard for a project-role ability that isn't tied to one project — see
 * `canAnywhere`. */
export async function requireAnywhere(
  resource: Resource,
  action: Action
): Promise<void> {
  if (!(await canAnywhere(resource, action))) {
    redirect(`/forbidden?resource=${encodeURIComponent(resource)}&action=${action}`);
  }
}

/** Server-action guard for the same — returns an inline failure, or null. */
export async function authorizeAnywhere(
  resource: Resource,
  action: Action
): Promise<{ ok: false; error: string } | null> {
  if (await canAnywhere(resource, action)) return null;
  return { ok: false, error: permissionMessage(resource, action) };
}

/**
 * Project-aware check. True when the user has `action` on `resource` for this
 * project — either department-wide (their global role) or via their membership
 * on the project. Backed by the has_project_permission() DB function.
 */
export async function canOnProject(
  projectId: string,
  resource: Resource,
  action: Action
): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("has_project_permission", {
    p_project: projectId,
    p_resource: resource,
    p_action: action,
  });
  return !error && data === true;
}

/** Project-aware page guard — redirects to /forbidden when not allowed. */
export async function requireProjectPermission(
  projectId: string,
  resource: Resource,
  action: Action
): Promise<void> {
  if (!(await canOnProject(projectId, resource, action))) {
    redirect(`/forbidden?resource=${encodeURIComponent(resource)}&action=${action}`);
  }
}

/** Project-aware server-action guard — returns an inline failure, or null. */
export async function authorizeProject(
  projectId: string,
  resource: Resource,
  action: Action
): Promise<{ ok: false; error: string } | null> {
  if (await canOnProject(projectId, resource, action)) return null;
  return { ok: false, error: permissionMessage(resource, action) };
}
