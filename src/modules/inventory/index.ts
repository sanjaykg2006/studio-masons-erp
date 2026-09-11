import { Boxes } from "lucide-react";

import type { ModuleDefinition } from "@/core/modules/registry";

/**
 * Inventory Management — tracks what a project has bought and what it still has,
 * plus the company's reusable assets. Two gated resources:
 *
 *   - `inventory.stock` (project-scoped): the per-project material tracker. The
 *     "material list" is the project's Budget BOQ — RECEIVED flows automatically
 *     from goods receipts (a PO line already links to its budget line), CONSUMED is
 *     recorded by hand on site, ON HAND = received − consumed.
 *   - `inventory.asset` (company-wide): the machines/monitors/printers registry.
 *     Each asset shows which project it's in and its custodian; moving one to
 *     another project is a two-party transfer the new custodian must accept.
 *
 * Reached through each project (the `inventory.stock` projectLink surfaces the
 * "Inventory" card) and from the Procurement hub (`/inventory`, the asset registry).
 * Mirrors the Procurement module's shape — writes via SECURITY DEFINER RPCs, reads
 * via RLS. Every verb here matches what migration 0054 enforces.
 */
export const inventoryModule: ModuleDefinition = {
  id: "inventory",
  label: "Inventory",
  href: "/inventory",
  icon: Boxes,
  // Reached through the Procurement hub + each project, not a top-level sidebar item.
  nav: false,
  requires: { resource: "inventory.asset", action: "read" },
  resources: [
    {
      id: "inventory.stock",
      label: "Inventory · Project material",
      actions: ["read", "create", "update"],
      homes: ["project", "department"],
      projectLink: { segment: "inventory", icon: Boxes },
    },
    {
      id: "inventory.asset",
      label: "Inventory · Company assets",
      actions: ["read", "create", "update", "delete"],
      homes: ["department", "company"],
    },
  ],
};
