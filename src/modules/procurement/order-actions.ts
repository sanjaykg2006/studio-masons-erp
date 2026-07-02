"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/core/supabase/server";
import { createAdminClient } from "@/core/supabase/admin";
import { logAudit } from "@/modules/audit/log";
import type { ReceiptLineDraft } from "@/modules/procurement/types";

const DOCS_BUCKET = "procurement-docs";
const MAX_DOC_BYTES = 25 * 1024 * 1024; // 25 MB
type OrderDocKind = "po" | "acceptance";

export type ActionResult = { ok: true } | { ok: false; error: string };
const ok: ActionResult = { ok: true };
const fail = (error: string): ActionResult => ({ ok: false, error });

const refreshList = (projectId: string) => revalidatePath(`/projects/${projectId}/orders`);
const refreshOne = (projectId: string, orderId: string) =>
  revalidatePath(`/projects/${projectId}/orders/${orderId}`);

/** Create one draft PO per winning vendor of an awarded comparison. */
export async function createOrdersFromComparison(
  projectId: string,
  comparisonId: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_orders_from_comparison", {
    p_comparison: comparisonId,
  });
  if (error) return fail(error.message);
  if ((data as number) === 0) return fail("Every awarded vendor already has a PO.");
  await logAudit("procurement.order.create", `Created ${data} purchase order(s)`, { projectId, comparisonId });
  refreshList(projectId);
  return ok;
}

export async function reviewOrder(projectId: string, orderId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_order", { p_order: orderId });
  if (error) return fail(error.message);
  await logAudit("procurement.order.review", "Finance signed off a PO", { projectId, orderId });
  refreshOne(projectId, orderId);
  return ok;
}

export async function approveOrder(projectId: string, orderId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_order", { p_order: orderId });
  if (error) return fail(error.message);
  await logAudit("procurement.order.approve", "Director signed off a PO", { projectId, orderId });
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

/** Upload the PO document or the vendor's acceptance letter. */
export async function uploadOrderDocument(
  projectId: string,
  orderId: string,
  kind: OrderDocKind,
  formData: FormData
): Promise<ActionResult> {
  const file = formData.get("file");
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
    .select("po_file, acceptance_file")
    .eq("id", orderId)
    .maybeSingle();
  const path = kind === "po" ? order?.po_file : order?.acceptance_file;
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

/** The MD clears an over-budget amendment (the senior bypass). */
export async function seniorBypassOrder(projectId: string, orderId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("senior_bypass_order", { p_order: orderId });
  if (error) return fail(error.message);
  await logAudit("procurement.order.bypass", "MD cleared an over-budget PO", { projectId, orderId });
  refreshOne(projectId, orderId);
  return ok;
}

/** Record a (partial) goods receipt against a released PO. */
export async function recordReceipt(
  projectId: string,
  orderId: string,
  receivedOn: string,
  notes: string,
  lines: ReceiptLineDraft[]
): Promise<ActionResult> {
  const clean = lines.filter((l) => l.qty > 0);
  if (clean.length === 0) return fail("Enter at least one received quantity.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_receipt", {
    p_order: orderId,
    p_received_on: receivedOn || null,
    p_notes: notes,
    p_lines: clean.map((l) => ({ order_line_id: l.order_line_id, qty: l.qty })),
  });
  if (error) return fail(error.message);
  await logAudit("procurement.receipt.record", "Recorded a goods receipt", { projectId, orderId });
  refreshOne(projectId, orderId);
  return ok;
}
