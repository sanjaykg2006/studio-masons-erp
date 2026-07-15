import { describe, expect, it } from "vitest";

import { computeApproval } from "@/modules/finance/types";
import type { TaxLine } from "@/modules/finance/types";

/**
 * Safety net for the invoice money math (Phase 3.1).
 *
 * `computeApproval` is the single source of truth shared by the accounts-
 * approval preview and — by mirroring it exactly — the DB function
 * accounts_approve_invoice (migration 0063). These tests lock the AGREED tax
 * rules so a future edit can't silently short-pay or over-pay a vendor:
 *   • GST      = sum of base × (sgst+cgst+igst)% per line.
 *   • TDS      = tds% of the WORK value (base + other charges); GST excluded.
 *   • Retention = 5% of the BASE (work) value, only when held.
 *   • Subtotal = base + GST + other charges (the full bill).
 *   • Payable  = subtotal − advance − TDS − retention, never below zero.
 *   • Every money amount rounded to 2 decimals (paise).
 */

const line = (base: number, sgst = 9, cgst = 9, igst = 0): TaxLine => ({
  base,
  sgst,
  cgst,
  igst,
});

/** Sensible defaults; each test overrides only what it exercises. */
const approve = (over: Partial<Parameters<typeof computeApproval>[0]> = {}) =>
  computeApproval({
    lines: [line(100000)],
    otherCharges: 0,
    tdsPct: 0,
    deductAdvance: false,
    advanceAmount: 0,
    holdRetention: false,
    advanceRemaining: 0,
    ...over,
  });

describe("computeApproval — the worked example from migration 0063", () => {
  it("₹1,00,000 base + 18% GST, 2% TDS, retention held → payable ₹1,11,000", () => {
    const c = approve({ tdsPct: 2, holdRetention: true });
    expect(c.baseSum).toBe(100000);
    expect(c.gstSum).toBe(18000);
    expect(c.subtotal).toBe(118000);
    expect(c.tdsAmount).toBe(2000); // 2% of base only, NOT of the GST-inclusive bill
    expect(c.retentionAmount).toBe(5000); // 5% of base
    expect(c.payable).toBe(111000);
  });

  it("splits GST as SGST+CGST or a single IGST identically", () => {
    const split = approve({ lines: [line(100000, 9, 9, 0)] });
    const igst = approve({ lines: [line(100000, 0, 0, 18)] });
    expect(split.gstSum).toBe(18000);
    expect(igst.gstSum).toBe(18000);
  });
});

describe("computeApproval — TDS base", () => {
  it("charges TDS on base + other charges, never on GST", () => {
    const c = approve({ otherCharges: 5000, tdsPct: 2 });
    expect(c.subtotal).toBe(123000); // 100000 + 18000 GST + 5000 other
    expect(c.tdsAmount).toBe(2100); // 2% of (100000 + 5000), GST excluded
    expect(c.payable).toBe(120900); // 123000 − 2100
  });

  it("is zero when TDS % is zero", () => {
    expect(approve({ tdsPct: 0 }).tdsAmount).toBe(0);
  });
});

describe("computeApproval — retention", () => {
  it("holds 5% of the base only when the box is ticked", () => {
    expect(approve({ holdRetention: true }).retentionAmount).toBe(5000);
    expect(approve({ holdRetention: false }).retentionAmount).toBe(0);
  });
});

describe("computeApproval — advance recovery", () => {
  it("caps the deduction at the smallest of amount, subtotal and remaining", () => {
    const c = approve({
      deductAdvance: true,
      advanceAmount: 200000, // asked for more than exists
      advanceRemaining: 50000, // only this much left on the PO advance
    });
    expect(c.deduct).toBe(50000);
    expect(c.payable).toBe(68000); // 118000 − 50000
  });

  it("ignores the advance entirely when the box is unticked", () => {
    const c = approve({ deductAdvance: false, advanceAmount: 200000, advanceRemaining: 50000 });
    expect(c.deduct).toBe(0);
    expect(c.payable).toBe(118000);
  });
});

describe("computeApproval — guards and rounding", () => {
  it("never returns a negative payable", () => {
    const c = approve({
      tdsPct: 2,
      deductAdvance: true,
      advanceAmount: 118000, // wipes out the whole bill
      advanceRemaining: 200000,
    });
    expect(c.deduct).toBe(118000);
    expect(c.payable).toBe(0); // 118000 − 118000 − 2000 would be negative → floored
  });

  it("rounds GST and totals to paise", () => {
    const c = approve({ lines: [line(12345.67, 0, 0, 18)] });
    expect(c.gstSum).toBe(2222.22); // 12345.67 × 18% = 2222.2206 → 2222.22
    expect(c.subtotal).toBe(14567.89); // 12345.67 + 2222.22
  });

  it("sums multiple lines before applying tax rules", () => {
    const c = approve({ lines: [line(60000), line(40000)], tdsPct: 2, holdRetention: true });
    expect(c.baseSum).toBe(100000);
    expect(c.gstSum).toBe(18000);
    expect(c.payable).toBe(111000); // same as the single-line worked example
  });
});
