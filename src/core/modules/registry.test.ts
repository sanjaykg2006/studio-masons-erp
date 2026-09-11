import { describe, expect, it } from "vitest";

import {
  effectiveHome,
  moduleResources,
  projectLinkModules,
  resourcesForModules,
} from "@/core/modules/registry";

const all = moduleResources();
const byId = new Map(all.map((r) => [r.id, r]));
const get = (id: string) => {
  const r = byId.get(id);
  if (!r) throw new Error(`no resource ${id}`);
  return r;
};

describe("moduleResources", () => {
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

  it("keeps Access Control as one row with its four verbs", () => {
    expect(get("access").actions).toEqual(["create", "read", "update", "delete"]);
  });

  it("exposes the enforced governance verbs on the brief resource", () => {
    const brief = get("project.brief");
    expect(brief.actions).toContain("review");
    expect(brief.actions).toContain("approve");
    // "issue" was removed — it was declared but never checked anywhere.
    expect(brief.actions).not.toContain("issue");
  });
});

describe("where each module is set", () => {
  it("defaults every resource to a place it allows, or none when it has its own grid", () => {
    for (const r of all) {
      const home = effectiveHome(r);
      if (r.everyDepartment) expect(home).toBe("department");
      else if (!r.homes?.length) expect(home).toBeNull();
      else expect(r.homes).toContain(home);
    }
    expect(effectiveHome(get("folder.access"))).toBeNull();
  });

  it("uses a stored choice only when the resource allows it", () => {
    const vendor = get("procurement.vendor");
    expect(effectiveHome(vendor, "company")).toBe("company");
    // The vendor list only checks job titles and team ticks: a Project-roles
    // home would be a dead tick, so it falls back to the default.
    expect(effectiveHome(vendor, "project")).toBe("department");
  });

  it("starts where each module lived before it became a setting", () => {
    expect(effectiveHome(get("procurement.order"))).toBe("project");
    expect(effectiveHome(get("finance.invoice"))).toBe("project");
    expect(effectiveHome(get("project.template"))).toBe("project");
    // Change orders have their own row (0087): view, raise and approve.
    expect(effectiveHome(get("project.change"))).toBe("project");
    expect(get("project.change").actions).toEqual(["read", "create", "approve"]);
    expect(effectiveHome(get("procurement.vendor"))).toBe("department");
    expect(effectiveHome(get("inventory.asset"))).toBe("department");
    expect(effectiveHome(get("audit"))).toBe("department");
    expect(effectiveHome(get("dashboard"))).toBe("company");
    expect(effectiveHome(get("pettycash.senior"))).toBe("company");
  });

  it("keeps project visibility on project roles only", () => {
    // Membership decides who sees a project; a per-person or job-title tick
    // would open every project.
    for (const id of ["project", "project.brief", "project.member"]) {
      expect(get(id).homes).toEqual(["project"]);
    }
  });

  it("never lets Access Control be given with a job title or a project role", () => {
    expect(get("access").homes).toEqual(["department"]);
  });

  it("never offers Project roles for a screen that doesn't check them", () => {
    // These are checked with has_permission, which reads job titles and team
    // ticks only. (project.template uses has_permission_anywhere, so it may.)
    for (const id of [
      "procurement.vendor",
      "inventory.asset",
      "finance.settings",
      "design.template",
      "pettycash.billing",
      "pettycash.pay",
      "audit",
      "errorlog",
    ]) {
      expect(get(id).homes).not.toContain("project");
    }
  });

  it("gives every department its tasks, settings and people abilities", () => {
    // These need no module allotting and never show on Access Control; the
    // database mirrors the list in is_department_ability().
    const built = all.filter((r) => r.everyDepartment);
    expect(new Set(built.map((r) => r.id))).toEqual(
      new Set(["department.tasks", "department.settings", "department.people"])
    );
  });
});

describe("resourcesForModules", () => {
  const idsOf = (ids: string[]) => resourcesForModules(ids).map((r) => r.id);

  it("returns exactly the resources whose module id is allotted — no more", () => {
    expect(idsOf(["procurement.order"])).toEqual(["procurement.order"]);
    expect(idsOf(["design.folder"])).not.toContain("project");
  });

  it("ignores unknown module ids and an empty allotment", () => {
    expect(resourcesForModules(["not.a.real.module"])).toEqual([]);
    expect(resourcesForModules([])).toEqual([]);
  });

  it("only surfaces resources that opt in via projectLink, with a segment + icon", () => {
    // The project page renders these; declaring projectLink is all it takes for a
    // new module's page to appear there — nothing is listed in the page itself.
    const linked = projectLinkModules().flatMap((g) => g.resources);
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
    const got = idsOf(["project", "project.brief", "design.folder", "procurement.order"]);
    expect(new Set(got)).toEqual(
      new Set(["project", "project.brief", "design.folder", "procurement.order"])
    );
  });
});
