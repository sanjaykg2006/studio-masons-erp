import { SidebarNav } from "@/components/layout/sidebar-nav";

/**
 * Desktop app sidebar. Hidden below the `md` breakpoint, where the mobile
 * drawer in the Topbar (`mobile-nav.tsx`) takes over. The nav list itself lives
 * in {@link SidebarNav}, shared with that drawer.
 */
export function Sidebar() {
  return (
    <aside className="bg-sidebar text-sidebar-foreground hidden w-60 shrink-0 flex-col border-r md:flex">
      <SidebarNav />
    </aside>
  );
}
