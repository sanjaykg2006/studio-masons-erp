"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { navModules, type ModuleDefinition } from "@/core/modules/registry";
import { usePermissions } from "@/core/rbac/can-client";
import { cn } from "@/lib/utils";

/**
 * App sidebar. The nav list is generated entirely from the module registry —
 * to add a link, register a module, not edit this file. A module hides its link
 * only when it declares an explicit `requires` permission the user lacks
 * (cosmetic; RLS is the real boundary).
 */
export function Sidebar() {
  const pathname = usePathname();
  const can = usePermissions();
  const visibleModules = navModules.filter(
    (m: ModuleDefinition) =>
      !m.requires || can(m.requires.resource, m.requires.action)
  );

  return (
    <aside className="bg-sidebar text-sidebar-foreground hidden w-60 shrink-0 flex-col border-r md:flex">
      <div className="flex h-14 items-center border-b px-5 font-semibold tracking-tight">
        Studio-<span className="text-primary">Masons</span>
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {visibleModules.map((m) => {
          const active =
            pathname === m.href || pathname.startsWith(`${m.href}/`);
          const Icon = m.icon;
          return (
            <Link
              key={m.id}
              href={m.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <Icon className="size-4" />
              {m.label}
            </Link>
          );
        })}
      </nav>
      <div className="text-muted-foreground border-t p-3 text-xs">
        ERP · Foundation
      </div>
    </aside>
  );
}
