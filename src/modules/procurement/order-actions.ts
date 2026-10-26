"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/core/supabase/server";
import { createAdminClient } from "@/core/supabase/admin";
import { takeUpload, takeUploads } from "@/core/uploads/server";
import { logAudit } from "@/modules/audit/log";
import type { OrderLineAssignment, ReceiptLineDraft } from "@/modules/procurement/types";

const DOCS_BUCKET = "procurement-docs";
const MAX_DOC_BYTES = 25 * 1024 * 1024; // 25 MB
type OrderDocKind = "po" | "acceptance" | "support";

export type ActionResult = { ok: true } | { ok: false; error: string };
const ok: ActionResult = { ok: true };
const fail = (error: string): ActionResult => ({ ok: false, error });

const refreshList = (projectId: string) => revalidatePath(`/projects/${projectId}/orders`);
const refreshOne = (projectId: string, orderId: string) =>
  revalidatePath(`/projects/${projectId}/orders/${orderId}`);

/**
 * Generate the draft POs for an approved intent. The Manager has assigned a vendor
 * + rate to each open line and attached a supporting document per vendor; lines
 * sharing a vendor merge into one PO. The form carries the line assignments as JSON
 * plus one file per vendor under `doc_<vendorId>`.
 */
export async function generateOrdersFromIntent(
  projectId: string,
  intentId: string,
  formData: FormData
): Promise<ActionResult> {
  let lines: OrderLineAssignment[];
  try {
    lines = JSON.parse(String(formData.get("lines") ?? "[]")) as OrderLineAssignment[];
  } catch {
    return fail("Something went wrong reading the form.");
  }
  lines = lines.filter((l) => l.intent_line_id && l.vendor_id);
  if (lines.length === 0) return fail("Assign a vendor and rate to at least one line.");

  const vendorIds = [...new Set(lines.map((l) => l.vendor_id))];
  const admin = createAdminClient();
  const uploaded: string[] = [];
  const vendorDocs: { vendor_id: string; support_file: string }[] = [];

  for (const vendorId of vendorIds) {
    const file = await takeUpload(formData, `doc_${vendorId}`);
    if (!(file instanceof File) || file.size === 0) {
      await admin.storage.from(DOCS_BUCKET).remove(uploaded);
      return fail("Attach a supporting document for every vendor.");
    }
    if (file.size > MAX_DOC_BYTES) {
      await admin.storage.from(DOCS_BUCKET).remove(uploaded);
      return fail("A supporting document is larger than 25 MB.");
    }
    const safeName = file.name.replace(/[^\w.\- ]+/g, "_");
    const path = `intent/${intentId}/support-${vendorId}-${crypto.randomUUID()}-${safeName}`;
    const { error: upErr } = await admin.storage
      .from(DOCS_BUCKET)
      .upload(path, file, { contentType: file.type || undefined, upsert: false });
    if (upErr) {
      await admin.storage.from(DOCS_BUCKET).remove(uploaded);
      return fail(upErr.message);
    }
    uploaded.push(path);
    vendorDocs.push({ vendor_id: vendorId, support_file: path });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_orders_from_intent", {
    p_intent: intentId,
    p_lines: lines.map((l) => ({
      intent_line_id: l.intent_line_id,
      vendor_id: l.vendor_id,
      rate: l.rate,
    })),
    p_vendor_docs: vendorDocs,
  });
  if (error) {
    await admin.storage.from(DOCS_BUCKET).remove(uploaded);
    return fail(error.message);
  }
  await logAudit("procurement.order.create", `Created ${data} purchase order(s) from an intent`, {
    projectId,
    intentId,
  });
  refreshList(projectId);
  revalidatePath(`/projects/${projectId}/intents`);
  revalidatePath(`/projects/${projectId}/intents/${intentId}/order`);
  return ok;
}

/**
 * Give (or refuse) the sign-off stage a PO is waiting on. Its stages — Finance
 * review then Director approval by default — are set on Access Control →
 * Approval flows. The last approval stamps the PO's sign-offs with whoever
 * decided, and only then can it be released.
 */
export async function decideOrder(
  projectId: string,
  orderId: string,
  approvalId: string,
  approve: boolean,
  note: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("approval_decide", {
    p_request: approvalId,
    p_approve: approve,
    p_note: note,
  });
  if (error) return fail(error.message);
  await logAudit(
    approve ? "procurement.order.approve" : "procurement.order.reject",
    approve ? "Gave a PO sign-off stage" : "Refused a PO sign-off",
    { projectId, orderId, approvalId }
  );
  refreshOne(projectId, orderId);
  refreshList(projectId);
  return ok;
}

/** Send a refused (or not yet started) PO through its approval stages again. */
export async function restartOrderApproval(
  projectId: string,
  orderId: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("restart_order_approval", { p_order: orderId });
  if (error) return fail(error.message);
  await logAudit("procurement.order.reapproval", "Sent a PO for approval again", {
    projectId,
    orderId,
  });
  refreshOne(projectId, orderId);
  return ok;
}

export async function releaseOrder(projectId: string, orderId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("release_order", { p_order: orderId });
  if (error) return fail(error.message);
  await logAudit("procurement.order.release", "Released a PO", { projectId, orderId });
  refreshOne(projectId, orderId);
  return ok;
}

/** Senior sign-off that clears an over-budget PO for release (procurement.order:manage). */
export async function seniorBypassOrder(projectId: string, orderId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("senior_bypass_order", { p_order: orderId });
  if (error) return fail(error.message);
  await logAudit("procurement.order.bypass", "Cleared an over-budget PO", { projectId, orderId });
  refreshOne(projectId, orderId);
  return ok;
}

/** Upload the PO document or the vendor's acceptance letter. */
export async function uploadOrderDocument(
  projectId: string,
  orderId: string,
  kind: OrderDocKind,
  formData: FormData
): Promise<ActionResult> {
  const file = await takeUpload(formData, "file");
  if (!(file instanceof File) || file.size === 0) return fail("Choose a file.");
  if (file.size > MAX_DOC_BYTES) return fail("File is larger than 25 MB.");

  const safeName = file.name.replace(/[^\w.\- ]+/g, "_");
  const path = `${orderId}/${kind}-${crypto.randomUUID()}-${safeName}`;

  const admin = createAdminClient();
  const { error: upErr } = await admin.storage
    .from(DOCS_BUCKET)
    .upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (upErr) return fail(upErr.message);

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_order_document", {
    p_order: orderId,
    p_kind: kind,
    p_path: path,
  });
  if (error) {
    await admin.storage.from(DOCS_BUCKET).remove([path]);
    return fail(error.message);
  }
  await logAudit("procurement.order.document", `Attached the ${kind} document`, { projectId, orderId, kind });
  refreshOne(projectId, orderId);
  return ok;
}

/** A short-lived signed link to download a PO's document. */
export async function getOrderDocumentUrl(
  orderId: string,
  kind: OrderDocKind
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  // RLS ensures the caller can only read orders they can see.
  const { data: order } = await supabase
    .from("procurement_orders")
    .select("po_file, acceptance_file, support_file")
    .eq("id", orderId)
    .maybeSingle();
  const path =
    kind === "po" ? order?.po_file : kind === "support" ? order?.support_file : order?.acceptance_file;
  if (!path) return { ok: false, error: "No file uploaded." };

  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(DOCS_BUCKET).createSignedUrl(path, 60);
  if (error || !data) return { ok: false, error: error?.message ?? "Could not create a link." };
  return { ok: true, url: data.signedUrl };
}

/** Open an amendment on a live PO (vendor stays fixed). */
export async function startAmendment(
  projectId: string,
  orderId: string,
  note: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("start_amendment", { p_order: orderId, p_note: note });
  if (error) return fail(error.message);
  await logAudit("procurement.order.amend", "Opened a PO amendment", { projectId, orderId });
  refreshOne(projectId, orderId);
  return ok;
}

/**
 * Withdraw an amendment opened by mistake.
 *
 * Puts the PO back exactly as it was — line edits undone, the Finance and
 * Director sign-offs the amendment cleared restored, status back to issued.
 * The amendment row is kept and stamped cancelled, so the trail still shows it
 * was opened and withdrawn.
 */
export async function cancelAmendment(
  projectId: string,
  orderId: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_amendment", { p_order: orderId });
  if (error) return fail(error.message);
  await logAudit("procurement.order.amend_cancel", "Cancelled a PO amendment", {
    projectId,
    orderId,
  });
  refreshOne(projectId, orderId);
  return ok;
}

/** Edit a line's quantity/rate during an amendment. */
export async function amendOrderLine(
  projectId: string,
  orderId: string,
  lineId: string,
  qty: number,
  rate: number
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("amend_order_line", { p_line: lineId, p_qty: qty, p_rate: rate });
  if (error) return fail(error.message);
  refreshOne(projectId, orderId);
  return ok;
}

/** The Procurement Manager requests cancellation of a released PO, with a reason. */
export async function requestOrderCancel(
  projectId: string,
  orderId: string,
  reason: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_order_cancel", { p_order: orderId, p_reason: reason });
  if (error) return fail(error.message);
  await logAudit("procurement.order.cancel_request", "Requested a PO cancellation", { projectId, orderId });
  refreshOne(projectId, orderId);
  return ok;
}

/** A Director approves the cancellation — the PO is cancelled, its balance freed. */
export async function approveOrderCancel(projectId: string, orderId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_order_cancel", { p_order: orderId });
  if (error) return fail(error.message);
  await logAudit("procurement.order.cancel", "Cancelled a PO", { projectId, orderId });
  refreshOne(projectId, orderId);
  refreshList(projectId);
  return ok;
}

/** A Director declines the cancellation request — the PO stays live. */
export async function rejectOrderCancel(projectId: string, orderId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_order_cancel", { p_order: orderId });
  if (error) return fail(error.message);
  await logAudit("procurement.order.cancel_reject", "Declined a PO cancellation", { projectId, orderId });
  refreshOne(projectId, orderId);
  return ok;
}

type ReceiptFile = { kind: "grn" | "extra"; name: string; path: string };

/**
 * Upload the receipt files a form carries — the GRN under "grn", extras under
 * "extras" — into the PO's folder. On any failure the files already uploaded are
 * removed again, so nothing is left behind unreferenced.
 */
async function uploadReceiptFiles(
  orderId: string,
  formData: FormData
): Promise<{ ok: true; files: ReceiptFile[] } | { ok: false; error: string }> {
  const grn = await takeUpload(formData, "grn");
  const picked = [
    ...(grn && grn.size > 0 ? [{ kind: "grn" as const, file: grn }] : []),
    ...(await takeUploads(formData, "extras"))
      .filter((f) => f.size > 0)
      .map((file) => ({ kind: "extra" as const, file })),
  ];
  const tooBig = picked.find((p) => p.file.size > MAX_DOC_BYTES);
  if (tooBig) return { ok: false, error: `"${tooBig.file.name}" is larger than 25 MB.` };

  const admin = createAdminClient();
  const files: ReceiptFile[] = [];
  for (const { kind, file } of picked) {
    const safeName = file.name.replace(/[^\w.\- ]+/g, "_");
    const path = `${orderId}/receipt-${kind}-${crypto.randomUUID()}-${safeName}`;
    const { error } = await admin.storage
      .from(DOCS_BUCKET)
      .upload(path, file, { contentType: file.type || undefined, upsert: false });
    if (error) {
      await removeReceiptFiles(files);
      return { ok: false, error: error.message };
    }
    files.push({ kind, name: file.name, path });
  }
  return { ok: true, files };
}

async function removeReceiptFiles(files: ReceiptFile[]) {
  if (files.length) await createAdminClient().storage.from(DOCS_BUCKET).remove(files.map((f) => f.path));
}

/**
 * Record a (partial) goods receipt against a released PO. The form must carry
 * the GRN under "grn"; extra files (photos, challan) go under "extras".
 */
export async function recordReceipt(
  projectId: string,
  orderId: string,
  receivedOn: string,
  notes: string,
  lines: ReceiptLineDraft[],
  /** A booked Finance invoice for this PO, when there is one. */
  invoiceId: string | null,
  /** The vendor's bill number, for goods that arrive before it is booked. */
  invoiceNo: string | null,
  formData: FormData
): Promise<ActionResult> {
  const clean = lines.filter((l) => l.qty > 0);
  if (clean.length === 0) return fail("Enter at least one received quantity.");

  const uploaded = await uploadReceiptFiles(orderId, formData);
  if (!uploaded.ok) return uploaded;
  if (!uploaded.files.some((f) => f.kind === "grn")) {
    await removeReceiptFiles(uploaded.files);
    return fail("Attach the GRN for this delivery.");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_receipt", {
    p_order: orderId,
    p_received_on: receivedOn || null,
    p_notes: notes,
    p_lines: clean.map((l) => ({ order_line_id: l.order_line_id, qty: l.qty })),
    p_invoice: invoiceId || null,
    p_invoice_no: invoiceNo?.trim() || null,
    p_files: uploaded.files,
  });
  if (error) {
    await removeReceiptFiles(uploaded.files);
    return fail(error.message);
  }
  await logAudit("procurement.receipt.record", "Recorded a goods receipt", { projectId, orderId });
  refreshOne(projectId, orderId);
  return ok;
}

/**
 * Attach files to a receipt already saved: the GRN when it has none yet (older
 * receipts), or more extras. Add-only — nothing is ever replaced.
 */
export async function addReceiptFiles(
  projectId: string,
  orderId: string,
  receiptId: string,
  formData: FormData
): Promise<ActionResult> {
  const uploaded = await uploadReceiptFiles(orderId, formData);
  if (!uploaded.ok) return uploaded;
  if (uploaded.files.length === 0) return fail("Choose a file.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("add_receipt_files", {
    p_receipt: receiptId,
    p_files: uploaded.files,
  });
  if (error) {
    await removeReceiptFiles(uploaded.files);
    return fail(error.message);
  }
  await logAudit("procurement.receipt.files", "Added files to a goods receipt", {
    projectId,
    orderId,
    receiptId,
  });
  refreshOne(projectId, orderId);
  return ok;
}

/** A short-lived signed link to download one of a receipt's files. */
export async function getReceiptFileUrl(
  fileId: string
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  // RLS ensures the caller can only read files on orders they can see.
  const { data: file } = await supabase
    .from("procurement_receipt_files")
    .select("storage_path")
    .eq("id", fileId)
    .maybeSingle();
  if (!file) return { ok: false, error: "File not found." };

  const { data, error } = await createAdminClient()
    .storage.from(DOCS_BUCKET)
    .createSignedUrl(file.storage_path, 60);
  if (error || !data) return { ok: false, error: error?.message ?? "Could not create a link." };
  return { ok: true, url: data.signedUrl };
}
