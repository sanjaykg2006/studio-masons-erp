import "server-only";

import { createClient } from "@/core/supabase/server";
import type { OrderDetail, OrderLine, OrderSummary } from "@/modules/procurement/types";

/** The purchase orders on a project (RLS-gated by procurement.order:read). */
export async function listProjectOrders(projectId: string): Promise<OrderSummary[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("list_project_orders", { p_project: projectId });
  return (data ?? []) as OrderSummary[];
}

/** The minimal project details the generated PO document prints in its header.
 *  RLS-gated: readable because the caller already has procurement.order:read here. */
export type OrderProjectHeader = {
  name: string;
  code: string | null;
  client: string | null;
  location: string | null;
};

export async function getOrderProjectHeader(
  projectId: string
): Promise<OrderProjectHeader | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select("name, code, client, location")
    .eq("id", projectId)
    .maybeSingle();
  return (data ?? null) as OrderProjectHeader | null;
}

/** One PO's header + its lines (with received-so-far). */
export async function getOrder(
  orderId: string
): Promise<{ order: OrderDetail; lines: OrderLine[] } | null> {
  const supabase = await createClient();
  const [{ data: header }, { data: lines }] = await Promise.all([
    supabase.rpc("get_order", { p_order: orderId }),
    supabase.rpc("get_order_lines", { p_order: orderId }),
  ]);
  const order = ((header ?? []) as OrderDetail[])[0];
  if (!order) return null;
  return { order, lines: (lines ?? []) as OrderLine[] };
}

/** One goods receipt on a PO, with what arrived and the bill it was under. */
export type OrderReceipt = {
  id: string;
  received_on: string;
  notes: string | null;
  recorded_by: string | null;
  recorded_name: string | null;
  created_at: string;
  /** A booked Finance invoice, when the receipt was linked to one. */
  invoice_id: string | null;
  invoice_ref: string | null;
  /** A bill number typed in when the invoice was not yet booked. */
  invoice_no: string | null;
  lines: { description: string; unit: string | null; qty_received: number }[];
};

/** The full receipt history for a PO, newest first. */
export async function listOrderReceipts(orderId: string): Promise<OrderReceipt[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("list_order_receipts", { p_order: orderId });
  return (data ?? []) as OrderReceipt[];
}

/** Invoices already booked against this PO, for the receipt's invoice picker. */
export async function listOrderInvoices(
  orderId: string
): Promise<{ id: string; label: string; vendor_invoice_date: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("list_order_invoices", { p_order: orderId });
  return (data ?? []) as { id: string; label: string; vendor_invoice_date: string }[];
}
