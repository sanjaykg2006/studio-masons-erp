import type { ReactNode } from "react";

import { requireUser } from "@/core/auth/get-user";
import { getPermissions } from "@/core/rbac/permissions";
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
  const permissions = [...(await getPermissions())];
  return (
    <AppShell user={user} permissions={permissions}>
      {children}
    </AppShell>
  );
}
