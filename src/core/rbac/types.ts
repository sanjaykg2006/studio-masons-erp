/**
 * RBAC type vocabulary.
 *
 * The model is intentionally tiny: a permission is a (resource, action) pair.
 *   - Action   — a fixed CRUD verb (mirrors the `app_action` enum in the DB).
 *   - Resource — a module id from the registry, e.g. "dashboard", "access".
 * Roles (named bags of permissions) and which permissions they grant live in
 * the database and are edited through the UI — never hard-coded here.
 */

/** The four CRUD verbs. Must stay in sync with the DB `app_action` enum. */
export const ACTIONS = ["create", "read", "update", "delete"] as const;
export type Action = (typeof ACTIONS)[number];

/** A resource is a module id (free-form string). "*" is the wildcard. */
export type Resource = string;

/** Canonical "resource:action" key used for cheap Set lookups. */
export type PermissionKey = `${Resource}:${Action}`;

export const permissionKey = (
  resource: Resource,
  action: Action
): PermissionKey => `${resource}:${action}`;

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
