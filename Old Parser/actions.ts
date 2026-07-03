"use server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma";

// A purchase-order line as exchanged with the client (plain numbers, JSON-safe).
export type POLine = {
  id: string;
  service: string;
  unit: string;
  quantity: number;
  rate: number;
  supplyRate?: number | null;
  installRate?: number | null;
  amount: number;
};

// A purchase order as exchanged with the client. Prisma Decimals are converted to
// numbers and dates to ISO strings so the object survives the server→client boundary.
export type PORecord = {
  id: string;
  projectId: string;
  projectName: string;
  vendorName: string;
  poNumber: string;
  poValue: number;
  poFileName: string | null;
  // PO-document details (persisted so a PO can be amended later).
  projectCode: string | null;
  subject: string | null;
  quotationRef: string | null;
  quotationDate: string | null;
  vendorAddress: string | null;
  vendorGstin: string | null;
  billingBranchId: string | null;
  commencement: string | null;
  completion: string | null;
  paymentTerms: string[];
  notes: Record<string, string> | null;
  annexRemarks: Record<string, string> | null;
  acceptanceFileName: string | null;
  advanceRequested: number | null;
  advanceApproved: boolean;
  advanceTdsPct: number | null;
  advancePayable: number | null;
  advanceConsumed: number;
  fixedContract: boolean;
  contractStart: string | null;
  contractEnd: string | null;
  createdAt: string;
  lines: POLine[];
};

type POWithLines = Prisma.PurchaseOrderGetPayload<{ include: { lines: true } }>;

function toRecord(po: POWithLines): PORecord {
  return {
    id: po.id,
    projectId: po.projectId,
    projectName: po.projectName,
    vendorName: po.vendorName,
    poNumber: po.poNumber,
    poValue: Number(po.poValue),
    poFileName: po.poFileName,
    projectCode: po.projectCode,
    subject: po.subject,
    quotationRef: po.quotationRef,
    quotationDate: po.quotationDate,
    vendorAddress: po.vendorAddress,
    vendorGstin: po.vendorGstin,
    billingBranchId: po.billingBranchId,
    commencement: po.commencement,
    completion: po.completion,
    paymentTerms: po.paymentTerms ?? [],
    notes: (po.notes as Record<string, string> | null) ?? null,
    annexRemarks: (po.annexRemarks as Record<string, string> | null) ?? null,
    acceptanceFileName: po.acceptanceFileName,
    advanceRequested: po.advanceRequested == null ? null : Number(po.advanceRequested),
    advanceApproved: po.advanceApproved,
    advanceTdsPct: po.advanceTdsPct == null ? null : Number(po.advanceTdsPct),
    advancePayable: po.advancePayable == null ? null : Number(po.advancePayable),
    advanceConsumed: Number(po.advanceConsumed),
    fixedContract: po.fixedContract,
    contractStart: po.contractStart,
    contractEnd: po.contractEnd,
    createdAt: po.createdAt.toISOString().slice(0, 10),
    lines: po.lines.map((l) => ({
      id: l.id,
      service: l.service,
      unit: l.unit,
      quantity: Number(l.quantity),
      rate: Number(l.rate),
      supplyRate: l.supplyRate == null ? null : Number(l.supplyRate),
      installRate: l.installRate == null ? null : Number(l.installRate),
      amount: Number(l.amount),
    })),
  };
}

// Finds an existing PO for a project + vendor (case-insensitive vendor match).
async function findPO(projectId: string, vendorName: string) {
  return prisma.purchaseOrder.findFirst({
    where: { projectId, vendorName: { equals: vendorName.trim(), mode: "insensitive" } },
    include: { lines: true },
  });
}

// Loads all purchase orders straight from the database — no demo seeding, so the
// app shows only what has actually been created.
export async function loadPurchaseOrders(): Promise<PORecord[]> {
  const pos = await prisma.purchaseOrder.findMany({
    include: { lines: true },
    orderBy: { createdAt: "asc" },
  });
  return pos.map(toRecord);
}

export type SavePOInput = {
  projectId: string;
  projectName: string;
  vendorName: string;
  poNumber: string;
  poValue: number;
  poFileName?: string;
  projectCode?: string;
  subject?: string;
  quotationRef?: string;
  quotationDate?: string;
  vendorAddress?: string;
  vendorGstin?: string;
  billingBranchId?: string;
  commencement?: string;
  completion?: string;
  paymentTerms?: string[];
  notes?: Record<string, string>;
  annexRemarks?: Record<string, string>;
  fixedContract?: boolean;
  contractStart?: string;
  contractEnd?: string;
  lines?: Array<{ service: string; unit: string; quantity: number; rate: number; supplyRate?: number | null; installRate?: number | null; amount: number }>;
};

// The PO-document detail fields, mapped to Prisma data (undefined → null so an amend
// can also clear a field). Shared by create and update.
function detailData(input: SavePOInput) {
  return {
    projectCode: input.projectCode ?? null,
    subject: input.subject ?? null,
    quotationRef: input.quotationRef ?? null,
    quotationDate: input.quotationDate ?? null,
    vendorAddress: input.vendorAddress ?? null,
    vendorGstin: input.vendorGstin ?? null,
    billingBranchId: input.billingBranchId ?? null,
    commencement: input.commencement ?? null,
    completion: input.completion ?? null,
    paymentTerms: input.paymentTerms ?? [],
    notes: input.notes ?? Prisma.JsonNull,
    annexRemarks: input.annexRemarks ?? Prisma.JsonNull,
  };
}

// Creates or updates the purchase order for a project + vendor. A vendor carries a
// single PO per project, so an existing one is updated (its lines replaced) rather
// than duplicated — this keeps the invoice-gating logic's one-PO-per-vendor invariant.
export async function savePurchaseOrder(input: SavePOInput): Promise<PORecord> {
  const existing = await findPO(input.projectId, input.vendorName);
  const lineData = (input.lines ?? []).map((l) => ({
    service: l.service,
    unit: l.unit,
    quantity: l.quantity,
    rate: l.rate,
    supplyRate: l.supplyRate ?? null,
    installRate: l.installRate ?? null,
    amount: l.amount,
  }));

  if (existing) {
    if (input.lines) {
      await prisma.purchaseOrderLine.deleteMany({ where: { poId: existing.id } });
    }
    const updated = await prisma.purchaseOrder.update({
      where: { id: existing.id },
      data: {
        poNumber: input.poNumber.trim(),
        poValue: input.poValue,
        poFileName: input.poFileName ?? existing.poFileName,
        ...detailData(input),
        fixedContract: input.fixedContract ?? false,
        contractStart: input.contractStart ?? null,
        contractEnd: input.contractEnd ?? null,
        ...(input.lines ? { lines: { create: lineData } } : {}),
      },
      include: { lines: true },
    });
    return toRecord(updated);
  }

  const created = await prisma.purchaseOrder.create({
    data: {
      projectId: input.projectId,
      projectName: input.projectName,
      vendorName: input.vendorName.trim(),
      poNumber: input.poNumber.trim(),
      poValue: input.poValue,
      poFileName: input.poFileName ?? null,
      ...detailData(input),
      fixedContract: input.fixedContract ?? false,
      contractStart: input.contractStart ?? null,
      contractEnd: input.contractEnd ?? null,
      lines: { create: lineData },
    },
    include: { lines: true },
  });
  return toRecord(created);
}

// Deletes a purchase order (its line items cascade away) for a project + vendor.
// No-op if there's no matching PO.
export async function deletePurchaseOrder(input: {
  projectId: string;
  vendorName: string;
}): Promise<void> {
  const po = await findPO(input.projectId, input.vendorName);
  if (!po) return;
  await prisma.purchaseOrder.delete({ where: { id: po.id } });
}

// Acceptance stage — record the acceptance document and the requested advance.
export async function acceptPurchaseOrder(input: {
  projectId: string;
  vendorName: string;
  acceptanceFileName: string;
  advanceRequested: number;
}): Promise<PORecord | null> {
  const po = await findPO(input.projectId, input.vendorName);
  if (!po) return null;
  const updated = await prisma.purchaseOrder.update({
    where: { id: po.id },
    data: { acceptanceFileName: input.acceptanceFileName, advanceRequested: input.advanceRequested },
    include: { lines: true },
  });
  return toRecord(updated);
}

// Accounts approves the advance with a TDS % — payable = requested minus TDS.
export async function approvePOAdvance(input: {
  projectId: string;
  vendorName: string;
  tdsPct: number;
}): Promise<PORecord | null> {
  const po = await findPO(input.projectId, input.vendorName);
  if (!po) return null;
  const requested = po.advanceRequested == null ? 0 : Number(po.advanceRequested);
  const payable = requested - (requested * input.tdsPct) / 100;
  const updated = await prisma.purchaseOrder.update({
    where: { id: po.id },
    data: { advanceApproved: true, advanceTdsPct: input.tdsPct, advancePayable: payable },
    include: { lines: true },
  });
  return toRecord(updated);
}

// Records advance consumed against an invoice at approval time.
export async function consumePOAdvance(input: {
  projectId: string;
  vendorName: string;
  amount: number;
}): Promise<void> {
  const po = await findPO(input.projectId, input.vendorName);
  if (!po) return;
  await prisma.purchaseOrder.update({
    where: { id: po.id },
    data: { advanceConsumed: Number(po.advanceConsumed) + input.amount },
  });
}
