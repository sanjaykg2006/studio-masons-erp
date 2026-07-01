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

/**
 * The caller's effective permission keys ON A SPECIFIC PROJECT (their global
 * grants ∪ grants from their membership role on that project). Used to gate the
 * per-project UI; the DB (has_project_permission via RLS) is the real boundary.
 */
export async function getProjectPermissions(
  projectId: string
): Promise<Set<PermissionKey>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_project_permissions", {
    p_project: projectId,
  });
  if (error || !data) return new Set();
  const rows = data as { resource: string; action: Action }[];
  return new Set(rows.map((row) => permissionKey(row.resource, row.action)));
}

/**
 * Whether the user can reach the company-wide Projects module — a project:read
 * grant (role OR team) OR membership on at least one project. Used for the
 * sidebar link and the /projects landing, since project-only members have no
 * global grant. Backed by the has_project_access() DB function.
 */
export async function hasProjectAccess(): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("has_project_access");
  return !error && data === true;
}

/**
 * Whether the user can reach the Design department's own screens (template
 * library + folder/stage/role settings). Backed by has_design_access().
 */
export async function hasDesignAccess(): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("has_design_access");
  return !error && data === true;
}

/**
 * Whether the user is on the Design department's team (or its lead / an admin).
 * Drives access to the Design task board. Backed by on_department_team().
 */
export async function hasDesignTeamAccess(): Promise<boolean> {
  const supabase = await createClient();
  const { data: deptId } = await supabase.rpc("design_department_id");
  if (!deptId) return false;
  const { data, error } = await supabase.rpc("on_department_team", {
    p_dept: deptId,
  });
  return !error && data === true;
}

/**
 * Whether the user is the lead of at least one department — drives the "Team
 * Access" sidebar link and gates the /team page. Backed by leads_any_department().
 */
export async function leadsAnyDepartment(): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("leads_any_department");
  return !error && data === true;
}

/** The department ids the current user leads. Empty for non-leads. */
export async function myLeadDepartmentIds(): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_lead_departments");
  if (error || !data) return [];
  return (data as { department_id: string }[]).map((d) => d.department_id);
}
