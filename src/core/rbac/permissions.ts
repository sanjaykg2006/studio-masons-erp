import { cache } from "react";

import { createClient } from "@/core/supabase/server";
import {
  type Action,
  type PermissionKey,
  type Resource,
  permissionKey,
} from "@/core/rbac/types";

/**
 * Loads the current user's effective permissions as a Set of "resource:action"
 * keys (including any "*:action" wildcards from a superadmin role).
 *
 * Backed by the `my_permissions` SECURITY DEFINER RPC so any authenticated user
 * can read THEIR OWN grants. Wrapped in React `cache()` so it runs at most once
 * per request, no matter how many `can()` checks a render tree makes.
 */
export const getPermissions = cache(async (): Promise<Set<PermissionKey>> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_permissions");

  if (error || !data) return new Set();

  const rows = data as { resource: string; action: Action }[];
  return new Set(rows.map((row) => permissionKey(row.resource, row.action)));
});

/**
 * Server-side permission check. True when the user (or their wildcard role) is
 * granted `action` on `resource`. Deny-by-default: anything not granted is false.
 */
export async function can(
  resource: Resource,
  action: Action
): Promise<boolean> {
  const perms = await getPermissions();
  return (
    perms.has(permissionKey(resource, action)) ||
    perms.has(permissionKey("*", action))
  );
}
