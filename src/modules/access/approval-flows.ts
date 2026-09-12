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
  /** Placeholder: the flow's editable approval stages (from the database) go
   * here. Only in flows with an `engineId`. */
  stages?: boolean;
};

export type ApprovalFlow = {
  id: string;
  /** The approval_flows id when its approval stages are editable (0089). */
  engineId?: string;
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
    engineId: "pettycash",
    label: "Petty Cash claim",
    where: "Petty Cash",
    steps: [
      { label: "Log a claim", rule: "Anyone signed in — no tick needed." },
      { label: "Approval stages", stages: true },
      {
        label: "Pay",
        resource: "pettycash.pay",
        action: "issue",
        rule: "Nobody pays or rejects their own claim.",
      },
    ],
    rules: [
      "A claim is approved or rejected by whoever can give the stage it is waiting on.",
      "Full-access administrators can act on any stage, as a backup — never on their own claim.",
      "A claim keeps the stages it started with; editing them affects new claims only.",
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
    engineId: "intent",
    label: "Purchase intent",
    where: "Project → Purchase intents",
    steps: [
      { label: "Raise the intent", resource: "procurement.intent", action: "create" },
      { label: "Approval stages", stages: true },
    ],
    rules: [
      "Approving the last stage also folds any line that already has a live PO into that PO's amendment.",
      "The person who raised an intent can still withdraw it while it is pending.",
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
    engineId: "vendor",
    label: "Vendor in the directory",
    where: "Procurement → Vendor directory",
    steps: [
      { label: "Add a vendor", resource: "procurement.vendor", action: "create" },
      { label: "Approval stages", stages: true },
    ],
    rules: [
      "Once decided, anyone with Vendors → Approve can still re-status a vendor (e.g. strike one off).",
    ],
  },
  {
    id: "change",
    engineId: "change_order",
    label: "Change order",
    where: "Project → Change Order Register",
    steps: [
      { label: "Raise a change order", resource: "project.change", action: "create" },
      { label: "Approval stages", stages: true },
    ],
    rules: [
      "Ticks are checked on the change order's project.",
      "Full-access administrators can act on any stage, as a backup.",
      "A change order keeps the stages it started with; editing them affects new ones only.",
    ],
  },
  {
    id: "brief",
    engineId: "brief",
    label: "Brief",
    where: "Project → Briefs",
    steps: [
      { label: "Fill in and submit for review", resource: "project.brief", action: "update" },
      { label: "Approval stages", stages: true },
    ],
    rules: [
      "Rejecting a stage sends the brief back for changes; submitting it again starts the stages afresh.",
      "Approving the last stage files the brief PDF and, once every brief is approved, moves the project to Brief approved.",
    ],
  },
  {
    id: "brief-revision",
    engineId: "brief_revision",
    label: "Brief revision (after the Design Freeze)",
    where: "Project → Briefs",
    steps: [
      { label: "Propose, edit and submit a revision", resource: "project.brief", action: "update" },
      { label: "Approval stages", stages: true },
    ],
    rules: [
      "Approving the last stage publishes the draft over the answers and re-files the brief PDF; rejecting returns it to draft.",
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
