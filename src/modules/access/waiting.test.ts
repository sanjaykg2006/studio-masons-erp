import { describe, expect, it } from "vitest";

import { daysWaiting, isStuck, STALE_DAYS } from "@/modules/access/waiting";

const now = Date.parse("2026-10-26T12:00:00Z");
const daysAgo = (n: number) => new Date(now - n * 24 * 60 * 60 * 1000).toISOString();

describe("waiting approvals", () => {
  it("counts whole days waited", () => {
    expect(daysWaiting(daysAgo(0), now)).toBe(0);
    expect(daysWaiting(daysAgo(3.5), now)).toBe(3);
  });

  it("is stuck when nobody can approve it, however new", () => {
    expect(isStuck({ can_approve: [], waiting_since: daysAgo(0) }, now)).toBe(true);
  });

  it("is stuck once it has waited too long", () => {
    expect(isStuck({ can_approve: ["Prem"], waiting_since: daysAgo(STALE_DAYS - 1) }, now)).toBe(false);
    expect(isStuck({ can_approve: ["Prem"], waiting_since: daysAgo(STALE_DAYS) }, now)).toBe(true);
  });
});
