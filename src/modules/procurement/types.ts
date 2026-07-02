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
  budgeted_qty: number;
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
export type IntentLineDraft = { budget_line_id: string; qty: number };

// ── Comparison ───────────────────────────────────────────────────────────────

export type ComparisonStatus = "draft" | "awarded";

export const COMPARISON_STATUS_LABEL: Record<ComparisonStatus, string> = {
  draft: "Draft",
  awarded: "Awarded",
};

/** A row from list_project_comparisons. */
export type ComparisonSummary = {
  id: string;
  title: string | null;
  package_id: string | null;
  package_name: string | null;
  status: ComparisonStatus;
  prepared_by: string | null;
  prepared_by_name: string | null;
  created_at: string;
  awarded_by: string | null;
  awarded_by_name: string | null;
  awarded_at: string | null;
  line_count: number;
  vendor_count: number;
  can_edit: boolean;
  can_award: boolean;
};

/** A released budget package offered when starting a comparison. */
export type PackageRef = { id: string; name: string };

/** A vendor on the project's approved-vendor list. */
export type ProjectVendor = {
  vendor_id: string;
  name: string;
  type: VendorType;
  approved_by: string | null;
  approved_by_name: string | null;
  approved_at: string;
};

export type ComparisonVendorRef = { vendor_id: string; name: string };
export type ComparisonQuote = { vendor_id: string; rate: number; make: string | null };
export type ComparisonAward = { vendor_id: string; qty: number; rate: number };

export type ComparisonLine = {
  id: string;
  budget_line_id: string | null;
  description: string;
  unit: string | null;
  qty: number;
  sort: number;
  quotes: ComparisonQuote[];
  award: ComparisonAward | null;
};

/** The fully-loaded comparison grid. */
export type ComparisonDetail = {
  id: string;
  title: string | null;
  status: ComparisonStatus;
  package_name: string | null;
  awarded_by_name: string | null;
  awarded_at: string | null;
  vendors: ComparisonVendorRef[];
  lines: ComparisonLine[];
  canEdit: boolean;
  canAward: boolean;
};

// ── Purchase orders + receipts ───────────────────────────────────────────────

export type OrderStatus = "draft" | "issued" | "closed";

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  draft: "Draft",
  issued: "Issued",
  closed: "Closed",
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
  line_count: number;
  total: number;
  can_review: boolean;
  can_approve: boolean;
  can_issue: boolean;
  can_receive: boolean;
};

/** A PO header from get_order. */
export type OrderDetail = {
  id: string;
  po_number: string | null;
  vendor_name: string;
  status: OrderStatus;
  notes: string | null;
  po_file: string | null;
  acceptance_file: string | null;
  finance_reviewed_by: string | null;
  finance_reviewed_name: string | null;
  director_approved_by: string | null;
  director_approved_name: string | null;
  issued_at: string | null;
  can_review: boolean;
  can_approve: boolean;
  can_issue: boolean;
  can_receive: boolean;
};

/** A PO line from get_order_lines, with received-so-far. */
export type OrderLine = {
  id: string;
  description: string;
  unit: string | null;
  qty_ordered: number;
  rate: number;
  amount: number;
  qty_received: number;
};

/** One line the user is receiving now. */
export type ReceiptLineDraft = { order_line_id: string; qty: number };
