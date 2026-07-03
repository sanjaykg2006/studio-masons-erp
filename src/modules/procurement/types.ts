// Pure Procurement types — safe to import from client components.

export type VendorType = "supplier" | "subcontractor" | "service";
export type VendorStatus = "draft" | "approved" | "rejected";

export const VENDOR_TYPE_LABEL: Record<VendorType, string> = {
  supplier: "Supplier",
  subcontractor: "Subcontractor",
  service: "Service",
};

export const VENDOR_STATUS_LABEL: Record<VendorStatus, string> = {
  draft: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

/** A row from the vendor directory (as returned by list_vendors). */
export type Vendor = {
  id: string;
  name: string;
  type: VendorType;
  trade: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  status: VendorStatus;
  approved_by: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  created_at: string;
};

/** The editable fields on a vendor (create + update share this shape). */
export type VendorInput = {
  name: string;
  type: VendorType;
  trade: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
};

// ── Budget BOQ ───────────────────────────────────────────────────────────────

export type BudgetStatus = "draft" | "released";

export const BUDGET_STATUS_LABEL: Record<BudgetStatus, string> = {
  draft: "Draft",
  released: "Released",
};

export type BudgetLine = {
  id: string;
  ref: string | null;
  description: string;
  unit: string | null;
  qty: number;
  rate: number;
  amount: number;
  sort: number;
};

export type BudgetPackage = {
  id: string;
  name: string;
  sort: number;
  lines: BudgetLine[];
};

/** A budget version in the version list (header only). */
export type BudgetVersion = {
  id: string;
  version_no: number;
  status: BudgetStatus;
  released_at: string | null;
  created_at: string;
};

/** The fully-loaded version currently on screen. */
export type BudgetDetail = BudgetVersion & {
  notes: string | null;
  packages: BudgetPackage[];
};

export type ProjectBudget = {
  versions: BudgetVersion[];
  current: BudgetDetail | null;
};

/** Project headline: released budget value vs value ordered on live POs. */
export type BudgetSpend = {
  budgetTotal: number;
  expenditureTotal: number;
};

/** Editable fields on a budget line. */
export type BudgetLineInput = {
  ref: string;
  description: string;
  unit: string;
  qty: number;
  rate: number;
};

// ── Purchase intents ─────────────────────────────────────────────────────────

export type IntentStatus = "pending" | "approved" | "rejected";

export const INTENT_STATUS_LABEL: Record<IntentStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

/** A row from list_project_intents. */
export type Intent = {
  id: string;
  status: IntentStatus;
  needed_by: string | null;
  notes: string | null;
  raised_by: string;
  raiser_name: string | null;
  created_at: string;
  approved_by: string | null;
  approver_name: string | null;
  approved_at: string | null;
  line_count: number;
  total_qty: number;
  over_budget_any: boolean;
  can_approve: boolean;
  can_withdraw: boolean;
};

/** A line within an intent (from get_intent_lines). */
export type IntentLine = {
  id: string;
  budget_line_id: string;
  package_name: string;
  ref: string | null;
  description: string;
  unit: string | null;
  location: string | null;
  budgeted_qty: number;
  budget_rate: number;
  qty_requested: number;
  over_budget: boolean;
  bypass_approved_by: string | null;
  bypass_by_name: string | null;
};

/** A released budget line offered in the "raise intent" picker. */
export type ReleasedBudgetLine = {
  budget_line_id: string;
  package_name: string;
  ref: string | null;
  description: string;
  unit: string | null;
  budgeted_qty: number;
  committed_qty: number;
};

/** One line the user is adding to a new intent. */
export type IntentLineDraft = { budget_line_id: string; qty: number; location: string };

// ── Enter vendor rates (approved intent → draft POs) ─────────────────────────

/** An approved-intent line still awaiting a vendor (from list_intent_open_lines). */
export type OpenIntentLine = {
  intent_line_id: string;
  package_id: string;
  package_name: string;
  ref: string | null;
  description: string;
  unit: string | null;
  location: string | null;
  budget_rate: number;
  open_qty: number;
};

/** One open line assigned to a vendor with its rate, sent when generating POs. */
export type OrderLineAssignment = { intent_line_id: string; vendor_id: string; rate: number };

// ── Purchase orders + receipts ───────────────────────────────────────────────

export type OrderStatus = "draft" | "issued" | "closed" | "amending" | "cancelled";

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  draft: "Draft",
  issued: "Issued",
  closed: "Closed",
  amending: "Amending",
  cancelled: "Cancelled",
};

/** A row from list_project_orders. */
export type OrderSummary = {
  id: string;
  po_number: string | null;
  vendor_id: string;
  vendor_name: string;
  status: OrderStatus;
  finance_reviewed_by: string | null;
  director_approved_by: string | null;
  issued_at: string | null;
  cancel_requested: boolean;
  line_count: number;
  total: number;
  budget_total: number;
  can_review: boolean;
  can_approve: boolean;
  can_issue: boolean;
  can_receive: boolean;
  can_cancel: boolean;
  can_approve_cancel: boolean;
};

/** A PO header from get_order. */
export type OrderDetail = {
  id: string;
  po_number: string | null;
  intent_id: string | null;
  vendor_name: string;
  vendor_trade: string | null;
  vendor_type: VendorType;
  vendor_contact_name: string | null;
  vendor_contact_phone: string | null;
  vendor_contact_email: string | null;
  status: OrderStatus;
  notes: string | null;
  version_no: number;
  over_budget: boolean;
  po_file: string | null;
  acceptance_file: string | null;
  support_file: string | null;
  finance_reviewed_by: string | null;
  finance_reviewed_name: string | null;
  director_approved_by: string | null;
  director_approved_name: string | null;
  senior_bypass_by: string | null;
  senior_bypass_name: string | null;
  issued_at: string | null;
  cancel_reason: string | null;
  cancel_requested_by: string | null;
  cancel_requested_name: string | null;
  cancelled_by: string | null;
  cancelled_name: string | null;
  can_review: boolean;
  can_approve: boolean;
  can_issue: boolean;
  can_receive: boolean;
  can_amend: boolean;
  can_cancel: boolean;
  can_approve_cancel: boolean;
  /** May clear an over-budget PO for release (the senior `manage` verb). */
  can_bypass: boolean;
};

/** A PO line from get_order_lines, with the budgeted rate and received-so-far. */
export type OrderLine = {
  id: string;
  description: string;
  unit: string | null;
  location: string | null;
  qty_ordered: number;
  rate: number;
  amount: number;
  budget_rate: number | null;
  qty_received: number;
};

/** One line the user is receiving now. */
export type ReceiptLineDraft = { order_line_id: string; qty: number };

// ── Spreadsheet import ───────────────────────────────────────────────────────

export type BudgetImportLine = {
  ref: string | null;
  description: string;
  unit: string | null;
  qty: number;
  rate: number;
};
/** Self-check of a sheet: does the parsed line sum match the sheet's own stated
 * total? "ok" = matches (within 0.5%), "warn" = differs (sheetTotal shown so the
 * QS can eyeball it), "none" = the sheet has no usable total row to check against. */
export type BudgetImportReconcile =
  | { status: "ok"; sheetTotal: number }
  | { status: "warn"; sheetTotal: number }
  | { status: "none" };
export type BudgetImportPackage = {
  name: string;
  lines: BudgetImportLine[];
  total: number;
  reconcile: BudgetImportReconcile;
};
export type BudgetImportPreview = {
  packages: BudgetImportPackage[];
  warnings: string[];
};
