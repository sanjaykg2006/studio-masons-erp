import type { ReactNode } from "react";

import { requireUser } from "@/core/auth/get-user";
import { getPermissions, hasDesignAccess } from "@/core/rbac/permissions";
import { permissionKey } from "@/core/rbac/types";
import { AppShell } from "@/components/layout/app-shell";

/**
 * Layout for every route in the (app) group. requireUser() guarantees an
 * authenticated user (redirecting to /login otherwise), so child pages can
 * assume a logged-in session. This is the server-side guard; middleware.ts is
 * the first line of defense.
 */
export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireUser();
  const [perms, designAccess] = await Promise.all([
    getPermissions(),
    hasDesignAccess(),
  ]);
  const permissions = [...perms];
  // Nav hint (cosmetic): project-only members have no global design grant, but
  // still need the Design link. RLS remains the real boundary.
  if (designAccess) {
    const key = permissionKey("design.project", "read");
    if (!permissions.includes(key)) permissions.push(key);
  }
  return (
    <AppShell user={user} permissions={permissions}>
      {children}
    </AppShell>
  );
}
