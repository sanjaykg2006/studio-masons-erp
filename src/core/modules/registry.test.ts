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

  it("splits department-wide vs per-project abilities so matrices don't mix", () => {
    // Mirrors Design's department_modules (see the access screens): its own
    // project + design modules, an allotted Procurement order, and the always-on
    // general modules. Each matrix must pull only what belongs to it.
    const designAllotted = [
      "project",
      "project.brief",
      "project.member",
      "project.template",
      "design.template",
      "design.folder",
      "procurement.order",
      // general/company modules are always available:
      "dashboard",
      "access",
      "audit",
    ];
    const scoped = resourcesForModules(designAllotted);

    // "Project roles" matrix = per-project work only.
    const roleRows = scoped.filter((r) => r.projectRole).map((r) => r.id);
    expect(new Set(roleRows)).toEqual(
      new Set([
        "project",
        "project.brief",
        "project.member",
        "project.template",
        "procurement.order",
      ])
    );
    // The bug report's offenders must be gone from the role matrix:
    for (const gone of ["access", "audit", "dashboard", "design.template"]) {
      expect(roleRows).not.toContain(gone);
    }

    // "People & Access" matrix = department-wide abilities only.
    const deptRows = scoped.filter((r) => r.departmentLevel).map((r) => r.id);
    expect(deptRows).not.toContain("project.template");
    expect(deptRows).toContain("design.template");
    expect(deptRows).not.toContain("access");
    expect(deptRows).not.toContain("procurement.order");
    expect(deptRows).not.toContain("project");
  });

  it("gives every resource at most one home", () => {
    // A row on both department screens is what made them look like copies of
    // each other (Projects sat on People & Access AND on Project roles).
    for (const r of moduleResources()) {
      expect(Boolean(r.departmentLevel && r.projectRole)).toBe(false);
    }
    // Projects lives on project roles, where Create = may start new projects.
    const [project] = resourcesForModules(["project"]);
    expect(project.projectRole).toBe(true);
    expect(project.departmentLevel).toBeFalsy();
    expect(project.actions).toContain("create");
  });

  it("gives every department its tasks, settings and people abilities", () => {
    // These need no module allotting and never show on Access Control; the
    // database mirrors the list in is_department_ability().
    const built = moduleResources().filter((r) => r.everyDepartment);
    expect(new Set(built.map((r) => r.id))).toEqual(
      new Set(["department.tasks", "department.settings", "department.people"])
    );
    for (const r of built) expect(r.departmentLevel).toBe(true);
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
