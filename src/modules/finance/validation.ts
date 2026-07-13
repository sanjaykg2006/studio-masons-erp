/**
 * Pure input validation for the Finance money forms. Kept out of actions.ts (a
 * "use server" file, whose every export must be an async action) so these
 * helpers can be imported and unit-tested directly.
 *
 * These give the user a clear up-front message ("TDS % must be between 0 and
 * 100") instead of letting bad input reach the database and bounce back a raw
 * error. The database RPCs remain the real guard; this is the friendly layer.
 */
import type { TaxLine } from "@/modules/finance/types";

const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** A percentage must be a real number between 0 and 100. */
function pctError(label: string, value: number): string | null {
  if (!isNum(value) || value < 0 || value > 100) return `${label} must be between 0 and 100.`;
  return null;
}

/** A money amount must be a real number that isn't negative. */
function amountError(label: string, value: number): string | null {
  if (!isNum(value)) return `${label} must be a valid amount.`;
  if (value < 0) return `${label} can't be negative.`;
  return null;
}

/**
 * Every GST line needs a valid, non-negative base and tax %s in 0–100, and at
 * least one line must carry a positive base.
 */
export function validateTaxLines(lines: TaxLine[]): string | null {
  if (!Array.isArray(lines) || lines.length === 0) return "Add at least one invoice line.";
  let hasBase = false;
  for (const l of lines) {
    if (!isNum(l.base)) return "Invoice line amounts must be valid numbers.";
    if (l.base < 0) return "Invoice line amounts can't be negative.";
    if (l.base > 0) hasBase = true;
    const tax =
      pctError("SGST %", l.sgst) ?? pctError("CGST %", l.cgst) ?? pctError("IGST %", l.igst);
    if (tax) return tax;
  }
  if (!hasBase) return "Enter a base amount on at least one line.";
  return null;
}

/** PM entering a vendor invoice. */
export function validateInvoiceEntry(input: {
  orderId: string;
  vendorInvoiceNo: string;
  vendorInvoiceDate: string;
  lines: TaxLine[];
}): string | null {
  if (!input.orderId) return "Choose the purchase order this invoice is against.";
  if (!input.vendorInvoiceNo.trim()) return "Enter the vendor's invoice number.";
  if (!input.vendorInvoiceDate) return "Enter the vendor's invoice date.";
  return validateTaxLines(input.lines);
}

/** Accounts booking the invoice (the money math). */
export function validateAccountsBooking(input: {
  lines: TaxLine[];
  otherCharges: number;
  tdsPct: number;
  deductAdvance: boolean;
  advanceAmount: number;
}): string | null {
  return (
    validateTaxLines(input.lines) ??
    amountError("Other charges", input.otherCharges) ??
    pctError("TDS %", input.tdsPct) ??
    (input.deductAdvance
      ? !(input.advanceAmount > 0)
        ? "Enter the advance amount to deduct."
        : amountError("Advance", input.advanceAmount)
      : null)
  );
}

/** Raising a payment request against an approved invoice. */
export function validatePaymentRequest(amount: number): string | null {
  if (!isNum(amount) || amount <= 0) return "Enter an amount to pay.";
  return null;
}

/** Requesting an advance on a PO. */
export function validateAdvanceRequest(amount: number, tdsPct: number): string | null {
  if (!isNum(amount) || amount <= 0) return "Enter an advance amount.";
  return pctError("Advance TDS %", tdsPct);
}

/** Saving a billing branch. */
export function validateBillingBranch(name: string): string | null {
  if (!name.trim()) return "Enter a branch name.";
  return null;
}
