// Pure Petty Cash types — safe to import from client components.

export type PettyCashStatus =
  // Waiting on one of the flow's approval stages (0089) — which one is the
  // entry's stage_label, set on Access Control → Approval flows.
  | "pending_approval"
  | "pending_accounts"
  | "paid"
  | "rejected"
  // The old fixed steps; no claim is left in them since 0089.
  | "pending_billing"
  | "pending_md";

export type PettyCashKind = "reimbursement" | "float";

export const PETTYCASH_STATUS_LABEL: Record<PettyCashStatus, string> = {
  pending_approval: "Awaiting approval",
  pending_accounts: "Awaiting Accounts",
  paid: "Paid",
  rejected: "Rejected",
  pending_billing: "Awaiting Billing",
  pending_md: "Awaiting senior approval",
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
  /** Its approval request (the flow's stages, snapshotted when it was logged). */
  approval_id: string | null;
  /** The approval stage it is waiting on, while pending_approval. */
  stage_label: string | null;
  /** The viewer may approve or reject that stage. */
  can_approve: boolean;
  /** The viewer may pay (or reject at payment) — the fixed Accounts step. */
  can_pay: boolean;
  can_reject: boolean;
  /** The pay-by date set when logging it (optional). */
  due_date: string | null;
  paid_at: string | null;
};

export type PettyCashCategory = { id: string; name: string; active: boolean };

export type ProjectOption = { id: string; name: string };

export function inr(n: number): string {
  return `₹${(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}
