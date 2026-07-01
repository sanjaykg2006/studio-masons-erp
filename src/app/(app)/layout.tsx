import type { ReactNode } from "react";

import { requireUser } from "@/core/auth/get-user";
import {
  getPermissions,
  hasDesignAccess,
  hasProjectAccess,
  leadsAnyDepartment,
} from "@/core/rbac/permissions";
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
  const [perms, projectAccess, designAccess, isLead] = await Promise.all([
    getPermissions(),
    hasProjectAccess(),
    hasDesignAccess(),
    leadsAnyDepartment(),
  ]);
  const permissions = [...perms];
  // Nav hints (cosmetic): some links aren't tied to a real permission grant.
  // RLS remains the real boundary in every case.
  //  - project-only members have no global grant but need the Projects link.
  if (projectAccess) {
    const key = permissionKey("project", "read");
    if (!permissions.includes(key)) permissions.push(key);
  }
  //  - design-team members reach the Design department's own screens.
  if (designAccess) {
    const key = permissionKey("design.template", "read");
    if (!permissions.includes(key)) permissions.push(key);
  }
  //  - department leads need the Team Access link (lead-ness is membership, not a
  //    matrix grant), so inject the gate key the module's `requires` checks for.
  if (isLead) {
    const key = permissionKey("team.access", "read");
    if (!permissions.includes(key)) permissions.push(key);
  }
  return (
    <AppShell user={user} permissions={permissions}>
      {children}
    </AppShell>
  );
}
