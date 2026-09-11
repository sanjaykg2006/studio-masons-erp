/**
 * Editable approval stages (0089) — pure types and wording, safe in client code.
 *
 * A flow's fixed work steps (log, pay, raise…) live in approval-flows.ts; the
 * approval stages between them live in the database (approval_stages) and are
 * edited on Access Control → Approval flows. When an item is raised, the stages
 * that apply to it are snapshotted, so edits only affect new items.
 */
import type { Action } from "@/core/rbac/types";

export type Approver = "tick" | "senior" | "dept_lead" | "job_title";

export const APPROVERS: readonly Approver[] = ["tick", "senior", "dept_lead", "job_title"];

export const APPROVER_LABEL: Record<Approver, string> = {
  tick: "Anyone with a tick",
  senior: "Someone senior to the requester, with a tick",
  dept_lead: "The requester's department lead",
  job_title: "A specific job title",
};

export type ApprovalStageRow = {
  id: string;
  flow_id: string;
  position: number;
  label: string;
  approver: Approver;
  resource: string | null;
  action: Action | null;
  job_title_id: string | null;
  skip_job_title_ids: string[];
  min_amount: number | null;
  block_own: boolean;
};

/** A flow on the engine, as the Approval flows page and its editor need it. */
export type EngineFlow = {
  id: string;
  label: string;
  has_amount: boolean;
  stages: ApprovalStageRow[];
};

/** The plain-English rules on a stage, beyond holding its tick. */
export function stageRules(
  s: ApprovalStageRow,
  titleLabel: (id: string) => string
): string[] {
  const rules: string[] = [];
  if (s.approver === "senior") {
    rules.push("The approver's job title must be above the requester's in the job-title order.");
  }
  if (s.approver === "dept_lead") {
    rules.push("A lead of the requester's department (or of the project's department).");
  }
  if (s.approver === "job_title") {
    rules.push(
      s.job_title_id
        ? `Anyone with the job title ${titleLabel(s.job_title_id)}.`
        : "Its job title was deleted — only administrators can approve it now."
    );
  }
  if (s.skip_job_title_ids.length) {
    rules.push(`Skipped for: ${s.skip_job_title_ids.map(titleLabel).join(", ")}.`);
  }
  if (s.min_amount != null) {
    rules.push(`Only for amounts of ₹${Number(s.min_amount).toLocaleString("en-IN")} or more.`);
  }
  if (s.block_own) rules.push("The requester can't approve their own.");
  return rules;
}
