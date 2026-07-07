// Pure Petty Cash types — safe to import from client components.

export type PettyCashStatus =
  | "pending_billing"
  | "pending_md"
  | "pending_accounts"
  | "paid"
  | "rejected";

export type PettyCashKind = "reimbursement" | "float";

export const PETTYCASH_STATUS_LABEL: Record<PettyCashStatus, string> = {
  pending_billing: "Awaiting Billing",
  pending_md: "Awaiting MD",
  pending_accounts: "Awaiting Accounts",
  paid: "Paid",
  rejected: "Rejected",
};

export const KIND_LABEL: Record<PettyCashKind, string> = {
  reimbursement: "Reimbursement",
  float: "Cash float",
};

export type PettyCashEntry = {
  id: string;
  created_by: string;
  created_name: string | null;
  project_id: string | null;
  project_name: string | null;
  category_name: string | null;
  kind: PettyCashKind;
  amount: number;
  description: string | null;
  spent_on: string;
  file_path: string | null;
  status: PettyCashStatus;
  reject_reason: string | null;
  created_at: string;
  mine: boolean;
  can_billing: boolean;
  can_md: boolean;
  can_pay: boolean;
  can_reject: boolean;
};

export type PettyCashCategory = { id: string; name: string; active: boolean };

export type ProjectOption = { id: string; name: string };

export function inr(n: number): string {
  return `₹${(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}
