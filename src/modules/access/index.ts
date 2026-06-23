import { ShieldCheck } from "lucide-react";

import type { ModuleDefinition } from "@/core/modules/registry";

/**
 * Access Control module — the UI for RBAC itself. It eats its own dog food:
 * the page is gated by `access:read`, so only roles granted the "access"
 * resource can manage roles, the permission matrix, and user assignments.
 */
export const accessModule: ModuleDefinition = {
  id: "access",
  label: "Access Control",
  href: "/access",
  icon: ShieldCheck,
  nav: true,
  actions: ["create", "read", "update", "delete"],
  requires: { resource: "access", action: "read" },
};
