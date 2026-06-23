"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { navModules, type ModuleDefinition } from "@/core/modules/registry";
import { usePermissions } from "@/core/rbac/can-client";
import { cn } from "@/lib/utils";

/**
 * App sidebar. The nav list is generated entirely from the module registry —
 * to add a link, register a module, not edit this file.
 *
 * Visibility rule (cosmetic; RLS is the real boundary):
 *   1. An explicit `requires` wins — show only if the user has it.
 *   2. Otherwise, any module exposing a `read` action is hidden unless the user
 *      has `<module>:read`. So a role without read on a module never sees it.
 *   3. A module with no `read` action and no `requires` is always shown.
 */
export function Sidebar() {
  const pathname = usePathname();
  const can = usePermissions();
  const visibleModules = navModules.filter((m: ModuleDefinition) => {
    if (m.requires) return can(m.requires.resource, m.requires.action);
    if (m.actions?.includes("read")) return can(m.id, "read");
    return true;
  });

  return (
    <aside className="bg-sidebar text-sidebar-foreground hidden w-60 shrink-0 flex-col border-r md:flex">
      <div className="flex h-16 items-center border-b px-5">
        <Image
          src="/studio-masons-logo.svg"
          alt="Studio Masons"
          width={64}
          height={32}
          priority
          className="h-14 w-auto"
        />
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
