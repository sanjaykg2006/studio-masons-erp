import { History } from "lucide-react";

import type { ModuleDefinition } from "@/core/modules/registry";

/**
 * Activity Log module — a read-only window onto the audit trail. Gated by
 * `audit:read`, so the sidebar link and page appear only for people granted the
 * "audit" resource (admins get it via their '*' wildcard). Entries are written
 * by server actions, never created here. Given on the IT department's People &
 * Access page (0085).
 */
export const auditModule: ModuleDefinition = {
  id: "audit",
  label: "Activity Log",
  href: "/audit",
  icon: History,
  nav: true,
  resources: [
    { id: "audit", label: "Activity Log", actions: ["read"], departmentLevel: true },
  ],
  requires: { resource: "audit", action: "read" },
};
