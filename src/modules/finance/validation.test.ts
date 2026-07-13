import { describe, expect, it } from "vitest";

import type { TaxLine } from "@/modules/finance/types";
import {
  validateAccountsBooking,
  validateAdvanceRequest,
  validateBillingBranch,
  validateInvoiceEntry,
  validatePaymentRequest,
  validateTaxLines,
} from "@/modules/finance/validation";

const line = (base: number, sgst = 9, cgst = 9, igst = 0): TaxLine => ({ base, sgst, cgst, igst });

describe("validateTaxLines", () => {
  it("accepts at least one positive base with valid tax %s", () => {
    expect(validateTaxLines([line(100000)])).toBeNull();
    expect(validateTaxLines([line(0), line(50000, 0, 0, 18)])).toBeNull();
  });

  it("requires at least one line with a positive base", () => {
    expect(validateTaxLines([])).toBe("Add at least one invoice line.");
    expect(validateTaxLines([line(0)])).toBe("Enter a base amount on at least one line.");
  });

  it("rejects negative or non-numeric amounts", () => {
    expect(validateTaxLines([line(-1)])).toBe("Invoice line amounts can't be negative.");
    expect(validateTaxLines([line(Number.NaN)])).toBe("Invoice line amounts must be valid numbers.");
  });

  it("rejects tax percentages outside 0–100", () => {
    expect(validateTaxLines([line(100, 120)])).toBe("SGST % must be between 0 and 100.");
    expect(validateTaxLines([line(100, 9, -1)])).toBe("CGST % must be between 0 and 100.");
    expect(validateTaxLines([line(100, 9, 9, 200)])).toBe("IGST % must be between 0 and 100.");
  });
});

describe("validateInvoiceEntry", () => {
  const good = {
    orderId: "po-1",
    vendorInvoiceNo: "INV-42",
    vendorInvoiceDate: "2026-07-13",
    lines: [line(100000)],
  };

  it("accepts a complete entry", () => {
    expect(validateInvoiceEntry(good)).toBeNull();
  });

  it("flags each missing field", () => {
    expect(validateInvoiceEntry({ ...good, orderId: "" })).toMatch(/purchase order/);
    expect(validateInvoiceEntry({ ...good, vendorInvoiceNo: "  " })).toMatch(/invoice number/);
    expect(validateInvoiceEntry({ ...good, vendorInvoiceDate: "" })).toMatch(/invoice date/);
  });
});

describe("validateAccountsBooking", () => {
  const good = {
    lines: [line(100000)],
    otherCharges: 0,
    tdsPct: 2,
    deductAdvance: false,
    advanceAmount: 0,
  };

  it("accepts a valid booking", () => {
    expect(validateAccountsBooking(good)).toBeNull();
  });

  it("rejects an out-of-range TDS or negative other charges", () => {
    expect(validateAccountsBooking({ ...good, tdsPct: 150 })).toBe("TDS % must be between 0 and 100.");
    expect(validateAccountsBooking({ ...good, otherCharges: -5 })).toBe("Other charges can't be negative.");
  });

  it("requires an advance amount when deducting an advance", () => {
    expect(validateAccountsBooking({ ...good, deductAdvance: true, advanceAmount: 0 })).toBe(
      "Enter the advance amount to deduct."
    );
    expect(validateAccountsBooking({ ...good, deductAdvance: true, advanceAmount: 5000 })).toBeNull();
  });
});

describe("validatePaymentRequest", () => {
  it("requires a positive amount", () => {
    expect(validatePaymentRequest(5000)).toBeNull();
    expect(validatePaymentRequest(0)).toBe("Enter an amount to pay.");
    expect(validatePaymentRequest(-1)).toBe("Enter an amount to pay.");
    expect(validatePaymentRequest(Number.NaN)).toBe("Enter an amount to pay.");
  });
});

describe("validateAdvanceRequest", () => {
  it("requires a positive amount and a valid TDS %", () => {
    expect(validateAdvanceRequest(50000, 2)).toBeNull();
    expect(validateAdvanceRequest(0, 2)).toBe("Enter an advance amount.");
    expect(validateAdvanceRequest(50000, 120)).toBe("Advance TDS % must be between 0 and 100.");
  });
});

describe("validateBillingBranch", () => {
  it("requires a name", () => {
    expect(validateBillingBranch("Head Office")).toBeNull();
    expect(validateBillingBranch("   ")).toBe("Enter a branch name.");
  });
});
