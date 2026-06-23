import { describe, expect, it } from "vitest";

import { ACTIONS, permissionKey } from "@/core/rbac/types";

describe("RBAC vocabulary", () => {
  it("exposes exactly the four CRUD verbs, in order", () => {
    expect(ACTIONS).toEqual(["create", "read", "update", "delete"]);
  });

  it("builds a canonical resource:action key", () => {
    expect(permissionKey("projects", "read")).toBe("projects:read");
    expect(permissionKey("*", "delete")).toBe("*:delete");
  });
});
