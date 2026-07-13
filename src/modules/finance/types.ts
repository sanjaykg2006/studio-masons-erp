// Pure Finance types + the shared money-math — safe to import from client components.

export type InvoiceStatus = "pending_director" | "pending_accounts" | "approved" | "rejected";
export type PaymentStatus = "pending_director" | "approved" | "paid" | "rejected";
export type RetentionStatus = "held" | "paid";

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  pending_director: "Awaiting Director",
  pending_accounts: "Awaiting Accounts",
  approved: "Approved",
  rejected: "Rejected",
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  pending_director: "Awaiting Director",
  approved: "Approved — to pay",
  paid: "Paid",
  rejected: "Rejected",
};

export const PRIORITY_LABEL: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

// ── Invoices ─────────────────────────────────────────────────────────────────

/** A single GST base line on an invoice. */
export type TaxLine = { base: number; sgst: number; cgst: number; igst: number };
/** Form shape for a tax line (string-backed inputs). */
export type TaxLineForm = { base: string; sgst: string; cgst: string; igst: string };
export const emptyTaxLine = (): TaxLineForm => ({ base: "", sgst: "9", cgst: "9", igst: "0" });
export const MAX_TAX_LINES = 4;

/** A row from list_project_invoices. */
export type InvoiceSummary = {
  id: string;
  invoice_no: string;
  vendor_invoice_no: string;
  vendor_name: string;
  po_number: string | null;
  vendor_invoice_date: string;
  due_date: string | null;
  status: InvoiceStatus;
  base_value: number;
  amount_total: number;
  amount_payable: number;
  requested_amount: number;
  remaining: number;
  days_due: number | null;
  cap_bypassed: boolean;
  over_cap: boolean;
  can_approve: boolean;
  can_book: boolean;
  can_manage: boolean;
  can_raise_payment: boolean;
  can_delete: boolean;
};

/** The full invoice header from get_invoice. */
export type InvoiceDetail = {
  id: string;
  invoice_no: string;
  vendor_invoice_no: string;
  vendor_invoice_date: string;
  due_date: string | null;
  vendor_name: string;
  po_number: string | null;
  order_id: string;
  status: InvoiceStatus;
  base_value: number;
  gst_amount: number;
  other_charges: number;
  amount_total: number;
  tds_pct: number | null;
  tds_amount: number;
  advance_deducted: number;
  retention_held: boolean;
  retention_amount: number;
  amount_payable: number;
  requested_amount: number;
  remaining: number;
  file_path: string | null;
  remarks: string | null;
  advance_remaining: number;
  cap_bypassed: boolean;
  over_cap: boolean;
  director_approved_name: string | null;
  accounts_approved_name: string | null;
  can_approve: boolean;
  can_book: boolean;
  can_manage: boolean;
};

export type InvoiceLine = { id: string; base: number; sgst: number; cgst: number; igst: number };

// ── Payment requests ─────────────────────────────────────────────────────────

export type PaymentSummary = {
  id: string;
  invoice_no: string;
  vendor_name: string;
  amount: number;
  priority: string;
  status: PaymentStatus;
  notes: string | null;
  created_at: string;
  can_approve: boolean;
  can_pay: boolean;
};

// ── Retention ────────────────────────────────────────────────────────────────

export type RetentionRow = {
  id: string;
  invoice_no: string;
  vendor_name: string;
  amount: number;
  due_date: string;
  status: RetentionStatus;
  is_due: boolean;
  early_requested: boolean;
  early_approved: boolean;
  can_pay: boolean;
  can_request_early: boolean;
  can_approve_early: boolean;
};

// ── POs & advances ───────────────────────────────────────────────────────────

export type FinanceOrder = {
  id: string;
  po_number: string | null;
  vendor_id: string;
  vendor_name: string;
  status: string;
  po_total: number;
  acceptance_on_file: boolean;
  fixed_contract: boolean;
  contract_start: string | null;
  contract_end: string | null;
  billing_branch_id: string | null;
  billing_branch_name: string | null;
  advance_requested: number | null;
  advance_tds_pct: number | null;
  advance_payable: number | null;
  advance_consumed: number | null;
  advance_remaining: number;
  advance_approved_at: string | null;
  advance_paid_at: string | null;
  can_set_terms: boolean;
  can_approve_advance: boolean;
  can_pay_advance: boolean;
};

export type BillingBranch = {
  id: string;
  name: string;
  gstin: string | null;
  address: string | null;
  active: boolean;
};

// ── Reports ──────────────────────────────────────────────────────────────────

export type FinanceSummary = {
  total_owed: number;
  paid_this_month: number;
  advances_unpaid: number;
  retention_held: number;
};

export type VendorOutstanding = {
  vendor_id: string;
  vendor_name: string;
  invoiced: number;
  paid: number;
  retention_held: number;
  outstanding: number;
};

export type InvoiceAgeing = {
  invoice_no: string;
  vendor_name: string;
  project_name: string;
  base_value: number;
  gst_amount: number;
  tds_amount: number;
  amount_payable: number;
  paid: number;
  outstanding: number;
  approved_on: string;
  due_date: string | null;
  days_due: number;
};

// ── The money math (shared by the approve modal preview + display) ───────────

/** Round to 2 decimals (paise), matching the DB's round(x, 2). */
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Single source of truth for the accounts-approval maths. Mirrors the DB's
 * accounts_approve_invoice so the modal preview matches what the server stores.
 * TDS is charged on the work value (base + other charges), GST excluded;
 * retention is 5% of the base (work) value. All amounts rounded to paise.
 */
export function computeApproval(opts: {
  lines: TaxLine[];
  otherCharges: number;
  tdsPct: number;
  deductAdvance: boolean;
  advanceAmount: number;
  holdRetention: boolean;
  advanceRemaining: number;
}) {
  const baseSum = opts.lines.reduce((s, l) => s + l.base, 0);
  const gstSum = round2(opts.lines.reduce((s, l) => s + (l.base * (l.sgst + l.cgst + l.igst)) / 100, 0));
  const other = round2(opts.otherCharges);
  const total = round2(baseSum + gstSum);
  const subtotal = round2(total + other); // the full bill: base + GST + other
  const deduct = opts.deductAdvance
    ? Math.min(opts.advanceAmount, subtotal, opts.advanceRemaining)
    : 0;
  const afterAdvance = Math.max(0, subtotal - deduct);
  // TDS on the work value (base + other), GST excluded.
  const tdsAmount = round2(((baseSum + other) * opts.tdsPct) / 100);
  // Retention is 5% of the base (work) value.
  const retentionAmount = opts.holdRetention ? round2(baseSum * 0.05) : 0;
  const payable = Math.max(0, round2(subtotal - deduct - tdsAmount - retentionAmount));
  return { baseSum, gstSum, total, subtotal, deduct, afterAdvance, tdsAmount, retentionAmount, payable };
}

/** Rupee formatter used across the module. */
export function inr(n: number): string {
  return `₹${(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}
