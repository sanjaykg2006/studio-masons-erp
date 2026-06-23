import { describe, expect, it } from "vitest";

import { isValidEmail } from "@/modules/access/validation";

describe("isValidEmail", () => {
  it("accepts ordinary addresses", () => {
    expect(isValidEmail("jane@studio-masons.com")).toBe(true);
    expect(isValidEmail("a.b+tag@sub.example.co.uk")).toBe(true);
  });

  it("rejects malformed addresses", () => {
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("jane")).toBe(false);
    expect(isValidEmail("jane@")).toBe(false);
    expect(isValidEmail("jane@localhost")).toBe(false);
    expect(isValidEmail("jane @example.com")).toBe(false);
    expect(isValidEmail("jane@example .com")).toBe(false);
  });
});
