/**
 * Editable approval stages (0089, tightened in 0092) — pure types and wording,
 * safe in client code.
 *
 * A flow's fixed work steps (log, pay, raise…) live in approval-flows.ts; the
 * approval stages between them live in the database (approval_stages) and are
 * edited on Access Control → Approval flows. Each stage NAMES ONE ROLE and only
 * that role may give it — a job title, or a department's project role held on
 * the item's own project. When an item is raised, the stages that apply to it
 * are snapshotted, so edits only affect new items.
 */

/** How a stage's approver is named. */
export type Approver = "role" | "dept_lead";

export const APPROVERS: readonly Approver[] = ["role", "dept_lead"];

export const APPROVER_LABEL: Record<Approver, string> = {
  role: "One named role",
  dept_lead: "The requester's department lead",
};

/** A role a stage can name: a company job title, or a department's project role. */
export type RoleOption = {
  id: string;
  label: string;
  /** The department it belongs to, by name; null for a company-wide job title. */
  department: string | null;
  departmentId: string | null;
};

export type ApprovalStageRow = {
  id: string;
  flow_id: string;
  position: number;
  label: string;
  approver: Approver;
  /** The only role that may give this stage. Null = not chosen yet. */
  role_id: string | null;
  skip_job_title_ids: string[];
  min_amount: number | null;
  block_own: boolean;
};

/** A flow on the engine, as the Approval flows page and its editor need it. */
export type EngineFlow = {
  id: string;
  label: string;
  has_amount: boolean;
  /** Its items belong to a project, so a project role can be named on it. */
  has_project: boolean;
  stages: ApprovalStageRow[];
  /** The roles its stages may name: job titles, plus the project roles of the
   * departments allotted this flow's module. */
  roles: RoleOption[];
};

/** A stage nobody but an administrator can give, because it names no role. */
export const stageNeedsRole = (s: ApprovalStageRow) =>
  s.approver === "role" && !s.role_id;

/** The plain-English rules on a stage. */
export function stageRules(
  s: ApprovalStageRow,
  role: (id: string) => RoleOption | null,
  titleLabel: (id: string) => string
): string[] {
  const rules: string[] = [];
  if (s.approver === "dept_lead") {
    rules.push("Only a lead of the requester's department (or of the project's department) can give it.");
  } else {
    const r = s.role_id ? role(s.role_id) : null;
    if (!s.role_id) {
      rules.push("No approving role chosen yet — until one is, only an administrator can give it.");
    } else if (!r) {
      rules.push("Its role was deleted — choose a new one, or only an administrator can give it.");
    } else if (r.department) {
      rules.push(`Only ${r.department}'s ${r.label}, on the project the item belongs to.`);
    } else {
      rules.push(`Only ${r.label} can give it.`);
    }
  }
  if (s.skip_job_title_ids.length) {
    rules.push(`Skipped for: ${s.skip_job_title_ids.map(titleLabel).join(", ")}.`);
  }
  if (s.min_amount != null) {
    rules.push(`Only for amounts of ₹${Number(s.min_amount).toLocaleString("en-IN")} or more.`);
  }
  if (s.block_own) rules.push("The requester can't approve their own.");
  rules.push("Whoever gave an earlier stage of the same item can't give this one.");
  return rules;
}
