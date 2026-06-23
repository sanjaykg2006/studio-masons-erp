import { redirect } from "next/navigation";

import { can, getPermissions } from "@/core/rbac/permissions";
import { permissionMessage, type Action, type Resource } from "@/core/rbac/types";

export { can, getPermissions };

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
