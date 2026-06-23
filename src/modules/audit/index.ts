import { History } from "lucide-react";

import type { ModuleDefinition } from "@/core/modules/registry";

/**
 * Activity Log module — a read-only window onto the audit trail. Gated by
 * `audit:read`, so the sidebar link and page appear only for roles granted the
 * "audit" resource (admins get it via their '*' wildcard). Entries are written
 * by server actions, never created here.
 */
export const auditModule: ModuleDefinition = {
  id: "audit",
  label: "Activity Log",
  href: "/audit",
  icon: History,
  nav: true,
  actions: ["read"],
  requires: { resource: "audit", action: "read" },
};
