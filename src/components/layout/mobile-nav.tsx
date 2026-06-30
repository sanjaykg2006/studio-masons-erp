"use client";

import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";

import { SidebarNav } from "@/components/layout/sidebar-nav";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Mobile navigation: a hamburger button (shown only below the `md` breakpoint,
 * where the desktop {@link Sidebar} is hidden) that opens a slide-in drawer
 * reusing {@link SidebarNav}. Closes on link click, route change, Escape, or
 * tapping the backdrop.
 */
export function MobileNav() {
  const [open, setOpen] = useState(false);

  // Close on Escape and lock body scroll while the drawer is open.
  // (Navigation closes the drawer via SidebarNav's onNavigate link handler.)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  return (
    <div className="md:hidden">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Open navigation menu"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Menu className="size-5" />
      </Button>

      {/* Backdrop */}
      <div
        aria-hidden={!open}
        onClick={() => setOpen(false)}
        className={cn(
          "fixed inset-0 z-40 bg-black/50 transition-opacity",
          open ? "opacity-100" : "pointer-events-none opacity-0"
        )}
      />

      {/* Drawer */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        className={cn(
          "bg-sidebar text-sidebar-foreground fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r shadow-lg transition-transform duration-200 ease-in-out",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close navigation menu"
          onClick={() => setOpen(false)}
          className="absolute top-4 right-3 z-10"
        >
          <X className="size-5" />
        </Button>
        <SidebarNav onNavigate={() => setOpen(false)} />
      </aside>
    </div>
  );
}
