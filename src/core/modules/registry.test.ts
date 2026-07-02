import { describe, expect, it } from "vitest";

import {
  moduleResources,
  projectLinkModules,
  resourcesForModules,
} from "@/core/modules/registry";

describe("moduleResources", () => {
  const resources = moduleResources();
  const byId = new Map(resources.map((r) => [r.id, r]));

  it("flattens multi-resource modules into one row per sub-resource", () => {
    // Projects (project/brief/member) and Design (template/folder) each declare
    // several sub-resources; every one must appear as its own row.
    for (const id of [
      "project",
      "project.brief",
      "project.member",
      "design.template",
      "design.folder",
    ]) {
      expect(byId.has(id)).toBe(true);
    }
  });

  it("keeps single-resource modules as a single row (the access module)", () => {
    const access = byId.get("access");
    expect(access?.actions).toEqual(["create", "read", "update", "delete"]);
  });

  it("exposes the enforced governance verbs on the brief resource", () => {
    const brief = byId.get("project.brief");
    expect(brief?.actions).toContain("review");
    expect(brief?.actions).toContain("approve");
    // "issue" was removed — it was declared but never checked anywhere.
    expect(brief?.actions).not.toContain("issue");
  });
});

describe("resourcesForModules", () => {
  const idsOf = (ids: string[]) => resourcesForModules(ids).map((r) => r.id);

  it("returns exactly the resources whose module id is allotted — no more", () => {
    // A department that was allotted a Procurement order module sees that row and
    // nothing it wasn't given; this is what makes the role matrix data-driven.
    expect(idsOf(["procurement.order"])).toEqual(["procurement.order"]);
    expect(idsOf(["design.folder"])).not.toContain("project");
  });

  it("keeps the departmentLevel flag so the two matrices can split on it", () => {
    // People & Access shows department-level rows; the role matrix shows the rest.
    const [vendor] = resourcesForModules(["procurement.vendor"]);
    const [order] = resourcesForModules(["procurement.order"]);
    expect(vendor.departmentLevel).toBe(true);
    expect(order.departmentLevel).toBeFalsy();
  });

  it("ignores unknown module ids and an empty allotment", () => {
    expect(resourcesForModules(["not.a.real.module"])).toEqual([]);
    expect(resourcesForModules([])).toEqual([]);
  });

  it("only surfaces resources that opt in via projectLink, with a segment + icon", () => {
    // The project page renders these; declaring projectLink is all it takes for a
    // new module's page to appear there — nothing is listed in the page itself.
    const groups = projectLinkModules();
    const linked = groups.flatMap((g) => g.resources);
    expect(linked.length).toBeGreaterThan(0);
    for (const r of linked) {
      expect(r.projectLink?.segment).toBeTruthy();
      expect(r.projectLink?.icon).toBeTruthy();
    }
    // A resource without a project page (the vendor directory) must not be there.
    expect(linked.some((r) => r.id === "procurement.vendor")).toBe(false);
    expect(linked.some((r) => r.id === "procurement.order")).toBe(true);
  });

  it("resolves a real allotment (Design's modules) to their registry rows", () => {
    // Mirrors department_modules for Design: project.* + design.* + an allotted
    // Procurement order — every one should surface, nothing hardcoded per dept.
    const got = idsOf([
      "project",
      "project.brief",
      "design.folder",
      "procurement.order",
    ]);
    expect(new Set(got)).toEqual(
      new Set(["project", "project.brief", "design.folder", "procurement.order"])
    );
  });
});
