"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import {
  type Action,
  type PermissionKey,
  type Resource,
  permissionKey,
} from "@/core/rbac/types";

/**
 * Client-side permission gating. The server resolves the user's permission keys
 * once (in the app layout) and hands them down through this provider. Components
 * use them to HIDE controls a user can't action — this is cosmetic only; the
 * database (RLS) is what actually enforces access.
 */

type PermissionChecker = (resource: Resource, action: Action) => boolean;

const PermissionsContext = createContext<PermissionChecker | null>(null);

export function PermissionsProvider({
  permissions,
  children,
}: {
  permissions: PermissionKey[];
  children: ReactNode;
}) {
  const check = useMemo<PermissionChecker>(() => {
    const set = new Set(permissions);
    return (resource, action) =>
      set.has(permissionKey(resource, action)) ||
      set.has(permissionKey("*", action));
  }, [permissions]);

  return (
    <PermissionsContext.Provider value={check}>
      {children}
    </PermissionsContext.Provider>
  );
}

/** Returns a `can(resource, action)` checker. Defaults to deny outside a provider. */
export function usePermissions(): PermissionChecker {
  return useContext(PermissionsContext) ?? (() => false);
}

/** Renders `children` only if the user can `action` the `resource`. */
export function Can({
  resource,
  action,
  fallback = null,
  children,
}: {
  resource: Resource;
  action: Action;
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const can = usePermissions();
  return <>{can(resource, action) ? children : fallback}</>;
}
