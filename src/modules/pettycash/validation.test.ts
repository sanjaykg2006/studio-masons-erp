import { describe, expect, it } from "vitest";

import { validatePettyCash } from "@/modules/pettycash/validation";

describe("validatePettyCash", () => {
  it("accepts a positive amount with a known kind", () => {
    expect(validatePettyCash({ amount: 500, kind: "reimbursement" })).toBeNull();
    expect(validatePettyCash({ amount: 1200, kind: "float" })).toBeNull();
  });

  it("requires a positive amount", () => {
    expect(validatePettyCash({ amount: 0, kind: "float" })).toBe("Enter an amount.");
    expect(validatePettyCash({ amount: -10, kind: "float" })).toBe("Enter an amount.");
    expect(validatePettyCash({ amount: Number.NaN, kind: "float" })).toBe("Enter an amount.");
  });

  it("rejects an unknown kind", () => {
    expect(validatePettyCash({ amount: 500, kind: "gift" })).toMatch(/reimbursement or a cash float/);
  });
});
