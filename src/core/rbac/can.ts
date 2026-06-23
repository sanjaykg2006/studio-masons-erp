import { redirect } from "next/navigation";

import { can, getPermissions } from "@/core/rbac/permissions";
import type { Action, Resource } from "@/core/rbac/types";

export { can, getPermissions };

/**
 * Guard for protected Server Components / pages / server actions. Mirrors
 * requireUser(): if the user lacks `action` on `resource`, sends them back to
 * the dashboard (their safe home) instead of rendering a route they can't use.
 *
 * This is a convenience layer — the real boundary is RLS in the database.
 */
export async function requirePermission(
  resource: Resource,
  action: Action
): Promise<void> {
  if (!(await can(resource, action))) redirect("/dashboard");
}
