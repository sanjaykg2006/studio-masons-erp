/**
 * RBAC type vocabulary.
 *
 * The model is intentionally tiny: a permission is a (resource, action) pair.
 *   - Action   — a fixed CRUD verb (mirrors the `app_action` enum in the DB).
 *   - Resource — a module id from the registry, e.g. "dashboard", "access".
 * Roles (named bags of permissions) and which permissions they grant live in
 * the database and are edited through the UI — never hard-coded here.
 */

/**
 * The access verbs. The first four are the CRUD core; the last four are the
 * governance verbs the Design Department workflow needs (review before approval,
 * formal approval, external issue, and manage-access). The column order here is
 * the order shown in the permission matrix. Must stay in sync with the DB
 * `app_action` enum.
 */
export const ACTIONS = [
  "read",
  "create",
  "update",
  "review",
  "approve",
  "issue",
  "delete",
  "manage",
] as const;
export type Action = (typeof ACTIONS)[number];

/** A resource is a module id (free-form string). "*" is the wildcard. */
export type Resource = string;

/** Canonical "resource:action" key used for cheap Set lookups. */
export type PermissionKey = `${Resource}:${Action}`;

export const permissionKey = (
  resource: Resource,
  action: Action
): PermissionKey => `${resource}:${action}`;

/** Plain-English verb for each action, used in "no permission" messages. */
const ACTION_VERB: Record<Action, string> = {
  read: "view",
  create: "create",
  update: "change",
  review: "review",
  approve: "approve",
  issue: "issue",
  delete: "delete",
  manage: "manage access to",
};

/** Short column label for each verb, matching the framework's wording. */
export const ACTION_LABEL: Record<Action, string> = {
  read: "View",
  create: "Create",
  update: "Edit",
  review: "Review",
  approve: "Approve",
  issue: "Issue",
  delete: "Delete",
  manage: "Manage",
};

/**
 * A human-readable "you can't do this" message for a denied (resource, action).
 * Pure (no server deps) so both server guards and the Forbidden page can use it.
 * `label` overrides the raw resource id with a friendly name when known.
 */
export function permissionMessage(
  resource: Resource,
  action: Action,
  label?: string
): string {
  const what = label ?? (resource === "*" ? "this" : `"${resource}"`);
  return `You don't have permission to ${ACTION_VERB[action]} ${what}.`;
}

/** A role row as stored in `public.roles`. */
export type Role = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  is_system: boolean;
  /** The department this role lives under. NULL = a global/system role. */
  department_id: string | null;
};

/** A single granted permission as stored in `public.role_permissions`. */
export type RolePermission = {
  role_id: string;
  resource: Resource;
  action: Action;
};

/** A department row as stored in `public.departments`. */
export type Department = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  is_system: boolean;
};

/** A module<->department assignment from `public.department_modules`. */
export type DepartmentModule = {
  department_id: string;
  module_id: string;
};
