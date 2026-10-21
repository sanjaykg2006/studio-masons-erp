import { describe, expect, it } from "vitest";

import { actionLabel, actorLabel, namePerson } from "@/modules/audit/format";

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

describe("namePerson", () => {
  it("fills in {person}", () => {
    expect(namePerson("Added {person} to a department team", "Shane")).toBe(
      "Added Shane to a department team"
    );
  });

  it("names the person in older, generic entries", () => {
    expect(namePerson("Granted pettycash.pay:issue for a teammate", "Shane")).toBe(
      "Granted pettycash.pay:issue for Shane"
    );
    expect(namePerson("Deactivated a user", "Prem Kumar")).toBe("Deactivated Prem Kumar");
    expect(namePerson("Cleared a user's role", "Prem Kumar")).toBe("Cleared Prem Kumar's role");
    expect(namePerson("Removed a project member", "BETA 1")).toBe("Removed BETA 1");
    expect(namePerson("Appointed a department lead", "Srujan")).toBe(
      "Appointed Srujan as department lead"
    );
  });

  it("leaves the summary alone when the name isn't known", () => {
    expect(namePerson("Deactivated a user", null)).toBe("Deactivated a user");
    expect(namePerson("Deactivated a user", "  ")).toBe("Deactivated a user");
  });
});
