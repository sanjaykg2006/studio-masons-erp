import { ShieldCheck } from "lucide-react";

import type { ModuleDefinition } from "@/core/modules/registry";

/**
 * Access Control module — the UI for RBAC itself. It eats its own dog food:
 * the page is gated by `access:read`, so only people granted the "access"
 * resource can manage roles, the permission matrix, and user assignments.
 *
 * It belongs to the IT department (0085): the tick lives on IT's People &
 * Access page, and only a full-access Administrator may hand it out, since
 * whoever holds it can change anyone's access — their own included.
 */
export const accessModule: ModuleDefinition = {
  id: "access",
  label: "Access Control",
  href: "/access",
  icon: ShieldCheck,
  nav: true,
  resources: [
    {
      id: "access",
      label: "Access Control",
      actions: ["create", "read", "update", "delete"],
      homes: ["department"],
      whyNot: {
        company: "Access Control is only handed out through IT, by an Administrator.",
        project: "Access Control is only handed out through IT, by an Administrator.",
      },
    },
  ],
  requires: { resource: "access", action: "read" },
};
