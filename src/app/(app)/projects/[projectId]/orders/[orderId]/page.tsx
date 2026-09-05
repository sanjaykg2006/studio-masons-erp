import { notFound } from "next/navigation";

import { requireProjectPermission } from "@/core/rbac/can";
import {
  getOrder,
  getOrderProjectHeader,
  listOrderInvoices,
  listOrderReceipts,
} from "@/modules/procurement/order-data";
import { listBillingBranches } from "@/modules/finance/data";
import { OrderDetailView } from "@/modules/procurement/components/order-detail";

/** One purchase order (Procurement slice 5). */
export default async function OrderPage({
  params,
}: {
  params: Promise<{ projectId: string; orderId: string }>;
}) {
  const { projectId, orderId } = await params;
  await requireProjectPermission(projectId, "procurement.order", "read");

  const [loaded, project, branches, receipts, invoices] = await Promise.all([
    getOrder(orderId),
    getOrderProjectHeader(projectId),
    // The PO billing block prints from Finance's list, never from a copy in code.
    listBillingBranches(true),
    listOrderReceipts(orderId),
    listOrderInvoices(orderId),
  ]);
  if (!loaded) notFound();

  return (
    <OrderDetailView
      projectId={projectId}
      order={loaded.order}
      lines={loaded.lines}
      project={project}
      receipts={receipts}
      invoices={invoices}
      branches={branches}
    />
  );
}
