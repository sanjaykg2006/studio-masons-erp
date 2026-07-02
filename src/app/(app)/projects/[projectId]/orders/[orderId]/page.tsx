import { notFound } from "next/navigation";

import { requireProjectPermission } from "@/core/rbac/can";
import { getOrder } from "@/modules/procurement/order-data";
import { OrderDetailView } from "@/modules/procurement/components/order-detail";

/** One purchase order (Procurement slice 5). */
export default async function OrderPage({
  params,
}: {
  params: Promise<{ projectId: string; orderId: string }>;
}) {
  const { projectId, orderId } = await params;
  await requireProjectPermission(projectId, "procurement.order", "read");

  const loaded = await getOrder(orderId);
  if (!loaded) notFound();

  return <OrderDetailView projectId={projectId} order={loaded.order} lines={loaded.lines} />;
}
