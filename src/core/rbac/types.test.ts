import { describe, expect, it } from "vitest";

import { ACTIONS, ACTION_LABEL, permissionKey } from "@/core/rbac/types";

describe("RBAC vocabulary", () => {
  it("exposes the eight access verbs (CRUD + governance), in matrix order", () => {
    expect(ACTIONS).toEqual([
      "read",
      "create",
      "update",
      "review",
      "approve",
      "issue",
      "delete",
      "manage",
    ]);
  });

  it("has a display label for every verb", () => {
    for (const a of ACTIONS) {
      expect(ACTION_LABEL[a]).toBeTruthy();
    }
  });

  it("builds a canonical resource:action key", () => {
    expect(permissionKey("projects", "read")).toBe("projects:read");
    expect(permissionKey("*", "delete")).toBe("*:delete");
  });
});
