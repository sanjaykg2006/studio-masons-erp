"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/core/supabase/server";
import { logAudit } from "@/modules/audit/log";
import type { ReceiptLineDraft } from "@/modules/procurement/types";

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
