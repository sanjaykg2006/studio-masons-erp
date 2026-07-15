import { describe, expect, it } from "vitest";

import { errorActor, sourceLabel } from "@/modules/errorlog/format";

describe("sourceLabel", () => {
  it("names the two known sources in plain English", () => {
    expect(sourceLabel("client")).toBe("Website");
    expect(sourceLabel("server")).toBe("Backend");
  });

  it("passes through an unknown source unchanged", () => {
    expect(sourceLabel("cron")).toBe("cron");
  });
});

describe("errorActor", () => {
  it("shows the email when present", () => {
    expect(errorActor("jane@studio-masons.com")).toBe("jane@studio-masons.com");
  });

  it("falls back clearly when there was no signed-in user", () => {
    expect(errorActor(null)).toBe("Not signed in");
    expect(errorActor("   ")).toBe("Not signed in");
  });
});
