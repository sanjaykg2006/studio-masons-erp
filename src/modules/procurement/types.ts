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
