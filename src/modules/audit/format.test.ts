import { describe, expect, it } from "vitest";

import { actionLabel, actorLabel } from "@/modules/audit/format";

describe("actorLabel", () => {
  it("shows the name when present", () => {
    expect(actorLabel("Jane Doe", "jane@studio-masons.com")).toBe("Jane Doe");
  });

  it("falls back to the email when there's no name", () => {
    expect(actorLabel(null, "jane@studio-masons.com")).toBe("jane@studio-masons.com");
    expect(actorLabel("  ", "jane@studio-masons.com")).toBe("jane@studio-masons.com");
  });

  it("falls back to System for missing/blank actors", () => {
    expect(actorLabel(null, null)).toBe("System");
    expect(actorLabel("   ", "  ")).toBe("System");
  });
});

describe("actionLabel", () => {
  it("humanises dotted action codes", () => {
    expect(actionLabel("user.invite")).toBe("User invite");
    expect(actionLabel("permission.update")).toBe("Permission update");
    expect(actionLabel("role.create")).toBe("Role create");
  });

  it("handles single-word and empty codes safely", () => {
    expect(actionLabel("login")).toBe("Login");
    expect(actionLabel("")).toBe("");
  });
});
