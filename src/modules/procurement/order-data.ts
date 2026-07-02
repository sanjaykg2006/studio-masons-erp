import "server-only";

import { createClient } from "@/core/supabase/server";
import type { OrderDetail, OrderLine, OrderSummary } from "@/modules/procurement/types";

/** The purchase orders on a project (RLS-gated by procurement.order:read). */
export async function listProjectOrders(projectId: string): Promise<OrderSummary[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("list_project_orders", { p_project: projectId });
  return (data ?? []) as OrderSummary[];
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
