"use server";
// Procurement → Finance workflow server actions. The Budget BOQ released by the
// Senior QS Engineer gates every Purchase Intent: an intent line requesting more
// than the remaining budgeted quantity, or a brand-new item, is flagged so the
// Project Director must reconfirm before the normal flow continues. See the plan in
// the Purchase Orders page for how these stages chain together.
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { savePurchaseOrder } from "./actions";
import { Prisma } from "@/app/generated/prisma";

// ── DTOs (JSON-safe: Decimals → numbers, dates → ISO) ─────────────
export type BudgetLineDTO = {
  id: string;
  packageName: string | null;
  item: string;
  unit: string;
  budgetedQty: number;
  rate: number;
  supplyRate: number | null;
  installRate: number | null;
  amount: number;
  committedQty: number;
  remainingQty: number;
};
export type BudgetBoqDTO = {
  id: string;
  projectId: string;
  projectName: string;
  fileName: string | null;
  status: string; // DRAFT | RELEASED
  releasedBy: string | null;
  releasedAt: string | null;
  lines: BudgetLineDTO[];
};

export type IntentLineDTO = {
  id: string;
  budgetLineId: string | null;
  item: string;
  unit: string;
  requestedQty: number;
  isNewItem: boolean;
  exceedsBudget: boolean;
  availableQtyAtSubmit: number | null;
};
export type QuoteLineDTO = { id: string; item: string; unit: string; quantity: number; rate: number; supplyRate: number | null; installRate: number | null; amount: number };
export type VendorQuoteDTO = {
  id: string;
  vendorName: string;
  vendorGstin: string | null;
  vendorBankDetails: string | null;
  fileName: string | null;
  totalValue: number;
  lines: QuoteLineDTO[];
};
export type IntentDTO = {
  id: string;
  projectId: string;
  projectName: string;
  intentNumber: string;
  packageName: string | null;
  raisedBy: string;
  status: string;
  limitExceeded: boolean;
  pdApprovedBy: string | null;
  pdReconfirmed: boolean;
  pdRejectReason: string | null;
  comparisonFileName: string | null;
  chosenQuoteId: string | null;
  chosenVendorBoqFileName: string | null;
  financeApprovedBy: string | null;
  financeNotes: string | null;
  releasedPoId: string | null;
  createdAt: string;
  lines: IntentLineDTO[];
  quotes: VendorQuoteDTO[];
};

type BoqWithLines = Prisma.BudgetBoqGetPayload<{ include: { lines: true } }>;
type IntentFull = Prisma.PurchaseIntentGetPayload<{ include: { lines: true; quotes: { include: { lines: true } } } }>;

function boqToDTO(boq: BoqWithLines): BudgetBoqDTO {
  return {
    id: boq.id,
    projectId: boq.projectId,
    projectName: boq.projectName,
    fileName: boq.fileName,
    status: boq.status,
    releasedBy: boq.releasedBy,
    releasedAt: boq.releasedAt ? boq.releasedAt.toISOString() : null,
    lines: boq.lines.map((l) => {
      const budgeted = Number(l.budgetedQty);
      const committed = Number(l.committedQty);
      return {
        id: l.id,
        packageName: l.packageName,
        item: l.item,
        unit: l.unit,
        budgetedQty: budgeted,
        rate: Number(l.rate),
        supplyRate: l.supplyRate == null ? null : Number(l.supplyRate),
        installRate: l.installRate == null ? null : Number(l.installRate),
        amount: Number(l.amount),
        committedQty: committed,
        remainingQty: budgeted - committed,
      };
    }),
  };
}

function intentToDTO(i: IntentFull): IntentDTO {
  return {
    id: i.id,
    projectId: i.projectId,
    projectName: i.projectName,
    intentNumber: i.intentNumber,
    packageName: i.packageName,
    raisedBy: i.raisedBy,
    status: i.status,
    limitExceeded: i.limitExceeded,
    pdApprovedBy: i.pdApprovedBy,
    pdReconfirmed: i.pdReconfirmed,
    pdRejectReason: i.pdRejectReason,
    comparisonFileName: i.comparisonFileName,
    chosenQuoteId: i.chosenQuoteId,
    chosenVendorBoqFileName: i.chosenVendorBoqFileName,
    financeApprovedBy: i.financeApprovedBy,
    financeNotes: i.financeNotes,
    releasedPoId: i.releasedPoId,
    createdAt: i.createdAt.toISOString().slice(0, 10),
    lines: i.lines.map((l) => ({
      id: l.id,
      budgetLineId: l.budgetLineId,
      item: l.item,
      unit: l.unit,
      requestedQty: Number(l.requestedQty),
      isNewItem: l.isNewItem,
      exceedsBudget: l.exceedsBudget,
      availableQtyAtSubmit: l.availableQtyAtSubmit == null ? null : Number(l.availableQtyAtSubmit),
    })),
    quotes: i.quotes.map((q) => ({
      id: q.id,
      vendorName: q.vendorName,
      vendorGstin: q.vendorGstin,
      vendorBankDetails: q.vendorBankDetails,
      fileName: q.fileName,
      totalValue: Number(q.totalValue),
      lines: q.lines.map((ql) => ({
        id: ql.id,
        item: ql.item,
        unit: ql.unit,
        quantity: Number(ql.quantity),
        rate: Number(ql.rate),
        supplyRate: ql.supplyRate == null ? null : Number(ql.supplyRate),
        installRate: ql.installRate == null ? null : Number(ql.installRate),
        amount: Number(ql.amount),
      })),
    })),
  };
}

const intentInclude = { lines: true, quotes: { include: { lines: true } } } as const;

// Writes a dashboard activity entry — the "notify the PD" mechanism (and general
// audit trail) for the workflow, mirroring the server-side pattern in data.ts.
async function logEntry(input: { icon: string; color: string; route: string; text: string; bold: string; detail: string; by: string }) {
  await prisma.activityEntry.create({
    data: { id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, at: new Date(), ...input },
  });
}

// ── Budget BOQ ────────────────────────────────────────────────────
export async function loadBudgetBoq(projectId: string): Promise<BudgetBoqDTO | null> {
  if (!projectId) return null;
  const boq = await prisma.budgetBoq.findFirst({
    where: { projectId },
    include: { lines: true },
    orderBy: { createdAt: "desc" },
  });
  return boq ? boqToDTO(boq) : null;
}

export type BudgetLineInput = { packageName?: string; item: string; unit: string; budgetedQty: number; rate: number; supplyRate?: number; installRate?: number; amount?: number };

// Senior QS imports / re-imports the budget. Only allowed while DRAFT (or when no
// budget exists yet) — a RELEASED budget is locked. Replaces all lines.
export async function saveBudgetBoqDraft(input: {
  projectId: string;
  projectName: string;
  fileName?: string;
  lines: BudgetLineInput[];
}): Promise<BudgetBoqDTO> {
  await requireRole(["SENIOR_QS", "ADMIN"]);
  const existing = await prisma.budgetBoq.findFirst({ where: { projectId: input.projectId }, orderBy: { createdAt: "desc" } });
  if (existing && existing.status === "RELEASED") {
    throw new Error("The budget BOQ for this project is released and locked.");
  }
  const lineData = input.lines.map((l) => ({
    packageName: l.packageName ?? null,
    item: l.item.trim(),
    unit: l.unit.trim(),
    budgetedQty: l.budgetedQty,
    rate: l.rate,
    supplyRate: l.supplyRate ?? null,
    installRate: l.installRate ?? null,
    amount: l.amount ?? l.budgetedQty * l.rate,
  }));

  if (existing) {
    await prisma.budgetBoqLine.deleteMany({ where: { boqId: existing.id } });
    const updated = await prisma.budgetBoq.update({
      where: { id: existing.id },
      data: { fileName: input.fileName ?? existing.fileName, lines: { create: lineData } },
      include: { lines: true },
    });
    return boqToDTO(updated);
  }
  const created = await prisma.budgetBoq.create({
    data: {
      projectId: input.projectId,
      projectName: input.projectName,
      fileName: input.fileName ?? null,
      status: "DRAFT",
      lines: { create: lineData },
    },
    include: { lines: true },
  });
  return boqToDTO(created);
}

export async function releaseBudgetBoq(boqId: string): Promise<BudgetBoqDTO> {
  const user = await requireRole(["SENIOR_QS", "ADMIN"]);
  const boq = await prisma.budgetBoq.update({
    where: { id: boqId },
    data: { status: "RELEASED", releasedBy: user.name, releasedAt: new Date() },
    include: { lines: true },
  });
  await logEntry({ icon: "menu_book", color: "#0059a8", route: "/purchase-orders", text: "Budget BOQ released for", bold: boq.projectName, detail: `${user.name} released the budget BOQ for ${boq.projectName}. It is now the locked baseline for purchase intents.`, by: user.name });
  return boqToDTO(boq);
}

// Deletes the project's budget BOQ (cascading its lines) so the QS can re-import a
// corrected workbook — even a released one. Use with care: any intents already
// raised keep their snapshot, but the gating baseline is rebuilt on re-import.
export async function deleteBudgetBoq(projectId: string): Promise<void> {
  await requireRole(["SENIOR_QS", "ADMIN"]);
  await prisma.budgetBoq.deleteMany({ where: { projectId } });
}

// Procurement assigns a line to a package (package-wise split). Allowed after release.
export async function setLinePackage(lineId: string, packageName: string): Promise<void> {
  await requireRole(["PROCUREMENT_MANAGER", "ADMIN"]);
  await prisma.budgetBoqLine.update({ where: { id: lineId }, data: { packageName: packageName.trim() || null } });
}

// ── Purchase Intents ──────────────────────────────────────────────
export async function loadIntents(projectId: string): Promise<IntentDTO[]> {
  if (!projectId) return [];
  const rows = await prisma.purchaseIntent.findMany({
    where: { projectId },
    include: intentInclude,
    orderBy: { createdAt: "desc" },
  });
  return rows.map(intentToDTO);
}

export type IntentLineInput = { item: string; unit: string; requestedQty: number };

// Project Manager raises an intent. The gating check matches each line to the
// budget BOQ (case-insensitive, project-scoped): a missing match is a new item, and
// requestedQty above remaining (budgeted − committed) is over budget. Either flag
// sets limitExceeded, which forces the PD to reconfirm before approving.
export async function raiseIntent(input: {
  projectId: string;
  projectName: string;
  packageName?: string;
  lines: IntentLineInput[];
}): Promise<IntentDTO> {
  const user = await requireRole(["PROJECT_MANAGER", "ADMIN"]);
  if (!input.lines.length) throw new Error("An intent needs at least one item.");

  const budget = await prisma.budgetBoq.findFirst({
    where: { projectId: input.projectId, status: "RELEASED" },
    include: { lines: true },
  });
  if (!budget) throw new Error("No released budget BOQ for this project — the QS must release it first.");

  const count = await prisma.purchaseIntent.count();
  const intentNumber = `PI-${String(count + 1).padStart(3, "0")}`;

  let limitExceeded = false;
  const lineData = input.lines.map((l) => {
    const match = budget.lines.find((b) => b.item.trim().toLowerCase() === l.item.trim().toLowerCase());
    const isNewItem = !match;
    const remaining = match ? Number(match.budgetedQty) - Number(match.committedQty) : 0;
    const exceedsBudget = !isNewItem && l.requestedQty > remaining;
    if (isNewItem || exceedsBudget) limitExceeded = true;
    return {
      budgetLineId: match?.id ?? null,
      item: l.item.trim(),
      unit: l.unit.trim(),
      requestedQty: l.requestedQty,
      isNewItem,
      exceedsBudget,
      availableQtyAtSubmit: match ? remaining : null,
    };
  });

  const created = await prisma.purchaseIntent.create({
    data: {
      projectId: input.projectId,
      projectName: input.projectName,
      intentNumber,
      packageName: input.packageName ?? null,
      raisedBy: user.name,
      status: "PENDING_PD_APPROVAL",
      limitExceeded,
      lines: { create: lineData },
    },
    include: intentInclude,
  });

  await logEntry({
    icon: limitExceeded ? "warning" : "playlist_add_check",
    color: limitExceeded ? "#e30613" : "#0059a8",
    route: "/purchase-orders",
    text: limitExceeded ? "Reconfirmation needed on intent" : "Purchase intent raised",
    bold: `${intentNumber} (${input.projectName})`,
    detail: limitExceeded
      ? `${user.name} raised ${intentNumber} for ${input.projectName} which exceeds the budget BOQ (over-quantity or new item). Project Director reconfirmation is required before approval.`
      : `${user.name} raised ${intentNumber} for ${input.projectName}. Awaiting Project Director approval.`,
    by: user.name,
  });
  return intentToDTO(created);
}

// Project Director approves. An over-budget intent (limitExceeded) requires the PD
// to pass reconfirm=true, which records pdReconfirmed and lets the flow continue.
export async function approveIntent(input: { intentId: string; reconfirm?: boolean }): Promise<IntentDTO> {
  const user = await requireRole(["PROJECT_DIRECTOR", "ADMIN"]);
  const intent = await prisma.purchaseIntent.findUnique({ where: { id: input.intentId } });
  if (!intent) throw new Error("Intent not found.");
  if (intent.limitExceeded && !input.reconfirm) {
    throw new Error("This intent exceeds the budget BOQ — reconfirmation is required to approve.");
  }
  const updated = await prisma.purchaseIntent.update({
    where: { id: input.intentId },
    data: {
      status: "QUOTES_PENDING",
      pdApprovedBy: user.name,
      pdApprovedAt: new Date(),
      pdReconfirmed: intent.limitExceeded ? true : false,
      pdRejectReason: null,
    },
    include: intentInclude,
  });
  await logEntry({ icon: "verified", color: "#16a34a", route: "/purchase-orders", text: "Intent approved", bold: `${intent.intentNumber}${intent.limitExceeded ? " (limit reconfirmed)" : ""}`, detail: `${user.name} approved ${intent.intentNumber}. Procurement can now collect vendor quotes.`, by: user.name });
  return intentToDTO(updated);
}

export async function rejectIntent(input: { intentId: string; reason: string }): Promise<IntentDTO> {
  const user = await requireRole(["PROJECT_DIRECTOR", "ADMIN"]);
  const updated = await prisma.purchaseIntent.update({
    where: { id: input.intentId },
    data: { status: "PD_REJECTED", pdRejectReason: input.reason },
    include: intentInclude,
  });
  await logEntry({ icon: "block", color: "#ba1a1a", route: "/purchase-orders", text: "Intent rejected", bold: updated.intentNumber, detail: `${user.name} rejected ${updated.intentNumber}: ${input.reason}`, by: user.name });
  return intentToDTO(updated);
}

// ── Quotes / Comparison ───────────────────────────────────────────
export type QuoteLineInput = { item: string; unit: string; quantity: number; rate: number; supplyRate?: number; installRate?: number };
export async function addVendorQuote(input: {
  intentId: string;
  vendorName: string;
  vendorGstin?: string;
  vendorBankDetails?: string;
  fileName?: string;
  lines: QuoteLineInput[];
}): Promise<IntentDTO> {
  await requireRole(["PROCUREMENT_MANAGER", "ADMIN"]);
  const total = input.lines.reduce((s, l) => s + l.quantity * l.rate, 0);
  await prisma.vendorQuote.create({
    data: {
      intentId: input.intentId,
      vendorName: input.vendorName.trim(),
      vendorGstin: input.vendorGstin ?? null,
      vendorBankDetails: input.vendorBankDetails ?? null,
      fileName: input.fileName ?? null,
      totalValue: total,
      lines: { create: input.lines.map((l) => ({ item: l.item.trim(), unit: l.unit.trim(), quantity: l.quantity, rate: l.rate, supplyRate: l.supplyRate ?? null, installRate: l.installRate ?? null, amount: l.quantity * l.rate })) },
    },
  });
  const updated = await prisma.purchaseIntent.findUnique({ where: { id: input.intentId }, include: intentInclude });
  return intentToDTO(updated!);
}

export async function submitComparison(input: { intentId: string; comparisonFileName?: string }): Promise<IntentDTO> {
  const user = await requireRole(["PROCUREMENT_MANAGER", "ADMIN"]);
  const updated = await prisma.purchaseIntent.update({
    where: { id: input.intentId },
    data: { status: "COMPARISON_PENDING_PD", comparisonFileName: input.comparisonFileName ?? null },
    include: intentInclude,
  });
  await logEntry({ icon: "table_chart", color: "#0059a8", route: "/purchase-orders", text: "Comparison BOQ ready", bold: updated.intentNumber, detail: `${user.name} submitted the vendor comparison for ${updated.intentNumber}. Awaiting the Project Director's vendor selection.`, by: user.name });
  return intentToDTO(updated);
}

// Project Director picks the winning vendor and uploads the chosen-vendor BOQ.
export async function chooseVendor(input: { intentId: string; quoteId: string; chosenVendorBoqFileName?: string }): Promise<IntentDTO> {
  const user = await requireRole(["PROJECT_DIRECTOR", "ADMIN"]);
  const updated = await prisma.purchaseIntent.update({
    where: { id: input.intentId },
    data: { status: "PENDING_FINANCE", chosenQuoteId: input.quoteId, chosenVendorBoqFileName: input.chosenVendorBoqFileName ?? null },
    include: intentInclude,
  });
  const chosen = updated.quotes.find((q) => q.id === input.quoteId);
  await logEntry({ icon: "how_to_reg", color: "#0059a8", route: "/purchase-orders", text: "Vendor selected", bold: updated.intentNumber, detail: `${user.name} selected ${chosen?.vendorName ?? "a vendor"} for ${updated.intentNumber}. Awaiting Finance verification.`, by: user.name });
  return intentToDTO(updated);
}

// ── Finance ───────────────────────────────────────────────────────
export async function financeApprove(input: { intentId: string; notes?: string }): Promise<IntentDTO> {
  const user = await requireRole(["FINANCE", "ADMIN"]);
  const intent = await prisma.purchaseIntent.findUnique({ where: { id: input.intentId } });
  if (!intent?.chosenQuoteId) throw new Error("No chosen vendor to verify yet.");
  const updated = await prisma.purchaseIntent.update({
    where: { id: input.intentId },
    data: { status: "FINANCE_APPROVED", financeApprovedBy: user.name, financeApprovedAt: new Date(), financeNotes: input.notes ?? null },
    include: intentInclude,
  });
  await logEntry({ icon: "account_balance", color: "#16a34a", route: "/purchase-orders", text: "Finance verified vendor for", bold: updated.intentNumber, detail: `${user.name} verified the vendor's financial details for ${updated.intentNumber}. The PO can now be released.`, by: user.name });
  return intentToDTO(updated);
}

// ── PO release ────────────────────────────────────────────────────
// Releases the PO from the chosen vendor's quote: creates the PurchaseOrder via the
// existing generator action, draws down the budget (committedQty += requestedQty per
// matched item) so later intents see the reduced remaining, and closes the intent.
export async function releaseIntentPo(input: {
  intentId: string;
  poNumber: string;
  poFileName?: string;
}): Promise<IntentDTO> {
  const user = await requireRole(["PROCUREMENT_MANAGER", "ADMIN"]);
  const intent = await prisma.purchaseIntent.findUnique({ where: { id: input.intentId }, include: intentInclude });
  if (!intent) throw new Error("Intent not found.");
  if (intent.status !== "FINANCE_APPROVED") throw new Error("The PO can only be released after Finance approval.");
  const quote = intent.quotes.find((q) => q.id === intent.chosenQuoteId);
  if (!quote) throw new Error("No chosen vendor quote to import.");

  const po = await savePurchaseOrder({
    projectId: intent.projectId,
    projectName: intent.projectName,
    vendorName: quote.vendorName,
    poNumber: input.poNumber,
    poValue: Number(quote.totalValue),
    poFileName: input.poFileName,
    vendorGstin: quote.vendorGstin ?? undefined,
    lines: quote.lines.map((l) => ({ service: l.item, unit: l.unit, quantity: Number(l.quantity), rate: Number(l.rate), supplyRate: l.supplyRate == null ? undefined : Number(l.supplyRate), installRate: l.installRate == null ? undefined : Number(l.installRate), amount: Number(l.amount) })),
  });

  // Draw down the budget against the intent lines (the source of the requested
  // quantities), so the remaining-qty restriction reflects this PO next time.
  await Promise.all(
    intent.lines
      .filter((l) => l.budgetLineId)
      .map((l) =>
        prisma.budgetBoqLine.update({
          where: { id: l.budgetLineId! },
          data: { committedQty: { increment: l.requestedQty } },
        }),
      ),
  );

  const updated = await prisma.purchaseIntent.update({
    where: { id: input.intentId },
    data: { status: "PO_RELEASED", releasedPoId: po.id },
    include: intentInclude,
  });
  await logEntry({ icon: "receipt_long", color: "#e30613", route: "/purchase-orders", text: "PO released for", bold: `${quote.vendorName} (${updated.intentNumber})`, detail: `${user.name} released PO ${input.poNumber} for ${quote.vendorName} on ${updated.intentNumber}. Budget BOQ quantities drawn down.`, by: user.name });
  return intentToDTO(updated);
}
