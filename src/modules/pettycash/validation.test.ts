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

  it("allows no pay-by date, or one on or after the spend", () => {
    const base = { amount: 500, kind: "reimbursement", spentOn: "2026-09-10" };
    expect(validatePettyCash(base)).toBeNull();
    expect(validatePettyCash({ ...base, dueDate: "2026-09-10" })).toBeNull();
    expect(validatePettyCash({ ...base, dueDate: "2026-09-20" })).toBeNull();
  });

  it("rejects a pay-by date before the spend", () => {
    expect(
      validatePettyCash({ amount: 500, kind: "float", spentOn: "2026-09-10", dueDate: "2026-09-09" })
    ).toMatch(/pay-by date/);
  });
});
