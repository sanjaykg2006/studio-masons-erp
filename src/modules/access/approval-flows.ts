/**
 * Every approval flow in the ERP, step by step, with the tick each step needs.
 *
 * The flows themselves are fixed in the database (each step is its own RPC
 * with its own status), so this is a DESCRIPTION of them, not a switch: the
 * "Approval flows" page reads it, then fills in from live data who can do each
 * step today. Each step's resource/action is the exact check the step's RPC
 * makes (verified against the migrations); approval-flows.test.ts keeps every
 * one pointing at a real registry resource and verb.
 */
import type { Action } from "@/core/rbac/types";

export type FlowStep = {
  /** What happens at this step, in plain words. */
  label: string;
  /** The tick that allows it; omitted when anyone may do it. */
  resource?: string;
  action?: Action;
  /** Anything that applies on top of holding the tick. */
  rule?: string;
  /** Only happens in some cases (e.g. an over-budget PO). */
  optional?: boolean;
};

export type ApprovalFlow = {
  id: string;
  label: string;
  /** Where in the ERP it happens. */
  where: string;
  steps: FlowStep[];
  /** Rules for the whole flow. */
  rules?: string[];
};

export const APPROVAL_FLOWS: ApprovalFlow[] = [
  {
    id: "pettycash",
    label: "Petty Cash claim",
    where: "Petty Cash",
    steps: [
      { label: "Log a claim", rule: "Anyone signed in — no tick needed." },
      { label: "Billing check", resource: "pettycash.billing", action: "approve" },
      {
        label: "Senior approval",
        resource: "pettycash.senior",
        action: "approve",
        rule:
          "The approver's job title must be above the claimant's in the job-title order. Skipped for job titles with “Petty cash claims skip senior approval” switched on.",
      },
      { label: "Pay", resource: "pettycash.pay", action: "issue" },
    ],
    rules: [
      "Nobody approves or rejects their own claim.",
      "Only the owner of the step a claim is waiting on can reject it.",
      "Full-access administrators can act on any step, as a backup.",
    ],
  },
  {
    id: "invoice",
    label: "Vendor invoice",
    where: "Project → Finance",
    steps: [
      { label: "Enter the invoice", resource: "finance.invoice", action: "create" },
      { label: "Project Director approval", resource: "finance.invoice", action: "approve" },
      { label: "Accounts books it", resource: "finance.invoice", action: "review" },
      {
        label: "Override the PO amount cap",
        resource: "finance.invoice",
        action: "manage",
        optional: true,
        rule: "Only when the invoice is more than what is left on the PO.",
      },
    ],
    rules: ["An invoice is rejected at the approval or booking step, by whoever can do that step."],
  },
  {
    id: "payment",
    label: "Payment request",
    where: "Project → Finance",
    steps: [
      { label: "Raise the request", resource: "finance.payment", action: "create" },
      { label: "Approve or reject", resource: "finance.payment", action: "approve" },
      { label: "Pay", resource: "finance.payment", action: "issue" },
    ],
  },
  {
    id: "advance",
    label: "PO advance",
    where: "Project → Finance",
    steps: [
      { label: "Request the advance / set the PO terms", resource: "finance.advance", action: "update" },
      { label: "Approve", resource: "finance.advance", action: "approve" },
      { label: "Pay", resource: "finance.advance", action: "issue" },
    ],
  },
  {
    id: "retention",
    label: "Early release of retention",
    where: "Project → Finance",
    steps: [
      { label: "Request early release", resource: "finance.retention", action: "update" },
      { label: "Approve early release", resource: "finance.retention", action: "manage" },
      { label: "Pay", resource: "finance.retention", action: "issue" },
    ],
    rules: ["Retention that reaches its 12-month date goes straight to Pay."],
  },
  {
    id: "intent",
    label: "Purchase intent",
    where: "Project → Purchase intents",
    steps: [
      { label: "Raise the intent", resource: "procurement.intent", action: "create" },
      {
        label: "Approve, reject or withdraw",
        resource: "procurement.intent",
        action: "approve",
      },
    ],
  },
  {
    id: "order",
    label: "Purchase order",
    where: "Project → Purchase orders",
    steps: [
      {
        label: "Generate POs from an approved intent",
        resource: "procurement.order",
        action: "issue",
      },
      { label: "Finance review", resource: "procurement.order", action: "review" },
      { label: "Director approval", resource: "procurement.order", action: "approve" },
      {
        label: "Senior sign-off",
        resource: "procurement.order",
        action: "manage",
        optional: true,
        rule: "Only when the PO is over budget.",
      },
      { label: "Release the PO", resource: "procurement.order", action: "issue" },
    ],
    rules: [
      "Finance review and Director approval can happen in either order; both are needed before release.",
      "Cancelling an issued PO is requested with Purchase orders → Edit and approved with Purchase orders → Approve.",
    ],
  },
  {
    id: "budget",
    label: "Budget BOQ",
    where: "Project → Budget BOQ",
    steps: [
      { label: "Release the budget", resource: "procurement.budget", action: "update" },
      {
        label: "Re-version a released budget",
        resource: "procurement.budget",
        action: "approve",
      },
    ],
  },
  {
    id: "vendor",
    label: "Vendor in the directory",
    where: "Procurement → Vendor directory",
    steps: [
      { label: "Add a vendor", resource: "procurement.vendor", action: "create" },
      { label: "Approve or reject", resource: "procurement.vendor", action: "approve" },
    ],
  },
  {
    id: "change",
    label: "Change order",
    where: "Project → Change Order Register",
    steps: [
      { label: "Raise a change order", resource: "project.change", action: "create" },
      { label: "Approve or reject", resource: "project.change", action: "approve" },
    ],
  },
  {
    id: "brief",
    label: "Brief",
    where: "Project → Briefs",
    steps: [
      { label: "Fill in and submit for review", resource: "project.brief", action: "update" },
      {
        label: "Send back for changes",
        resource: "project.brief",
        action: "review",
        optional: true,
      },
      { label: "Approve", resource: "project.brief", action: "approve" },
    ],
  },
  {
    id: "brief-revision",
    label: "Brief revision (after the Design Freeze)",
    where: "Project → Briefs",
    steps: [
      { label: "Propose, edit and submit a revision", resource: "project.brief", action: "update" },
      {
        label: "Approve and publish, or return",
        resource: "project",
        action: "approve",
        rule: "Also allowed: the lead of the department that owns the project.",
      },
    ],
  },
  {
    id: "project",
    label: "Project sign-off",
    where: "Project",
    steps: [
      {
        label: "Finalise the project",
        resource: "project",
        action: "approve",
        rule: "Only once the brief is approved.",
      },
      { label: "Design Freeze (and reopen)", resource: "project", action: "approve" },
    ],
  },
];
