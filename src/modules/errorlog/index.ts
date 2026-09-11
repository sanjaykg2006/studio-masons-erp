import { Bug } from "lucide-react";

import type { ModuleDefinition } from "@/core/modules/registry";

/**
 * Error Log module — a read-only window onto technical failures (website crashes
 * and backend errors). Gated by `errorlog:read`, so the sidebar link and page
 * appear only for people granted the "errorlog" resource (top admins get it via
 * their '*' wildcard). Entries are written by the crash boundaries and by the
 * server error hook (instrumentation), never created here. Given on the IT
 * department's People & Access page (0085).
 */
export const errorLogModule: ModuleDefinition = {
  id: "errorlog",
  label: "Error Log",
  href: "/logs",
  icon: Bug,
  nav: true,
  resources: [
    { id: "errorlog", label: "Error Log", actions: ["read"], departmentLevel: true },
  ],
  requires: { resource: "errorlog", action: "read" },
};
