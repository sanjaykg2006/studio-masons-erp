import { describe, expect, it } from "vitest";

import { moduleResources } from "@/core/modules/registry";

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
