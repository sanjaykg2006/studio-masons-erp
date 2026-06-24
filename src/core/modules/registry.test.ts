import { describe, expect, it } from "vitest";

import { moduleResources } from "@/core/modules/registry";

describe("moduleResources", () => {
  const resources = moduleResources();
  const byId = new Map(resources.map((r) => [r.id, r]));

  it("flattens multi-resource modules into one row per sub-resource", () => {
    // The Design module declares four sub-resources; each must appear.
    for (const id of [
      "design.project",
      "design.brief",
      "design.template",
      "design.member",
    ]) {
      expect(byId.has(id)).toBe(true);
    }
  });

  it("keeps single-resource modules as a single row (the access module)", () => {
    const access = byId.get("access");
    expect(access?.actions).toEqual(["create", "read", "update", "delete"]);
  });

  it("exposes the governance verbs on the brief resource", () => {
    const brief = byId.get("design.brief");
    expect(brief?.actions).toContain("review");
    expect(brief?.actions).toContain("approve");
    expect(brief?.actions).toContain("issue");
  });
});
