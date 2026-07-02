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
