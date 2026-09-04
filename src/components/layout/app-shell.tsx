import type { ReactNode } from "react";

import type { AppUser } from "@/core/auth/types";
import { PermissionsProvider } from "@/core/rbac/can-client";
import type { PermissionKey } from "@/core/rbac/types";
import { AutoRefresh } from "@/components/layout/auto-refresh";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";

/**
 * The authenticated app frame: sidebar + topbar + scrollable content area.
 * Used by app/(app)/layout.tsx to wrap every protected page. The user's
 * permission keys are resolved server-side and shared via PermissionsProvider
 * so any client component can gate its UI with usePermissions()/<Can>.
 */
export function AppShell({
  user,
  permissions,
  children,
}: {
  user: AppUser;
  permissions: PermissionKey[];
  children: ReactNode;
}) {
  return (
    <PermissionsProvider permissions={permissions}>
      <AutoRefresh />
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <Topbar user={user} />
          <main className="flex-1 overflow-y-auto p-6">{children}</main>
        </div>
      </div>
    </PermissionsProvider>
  );
}
