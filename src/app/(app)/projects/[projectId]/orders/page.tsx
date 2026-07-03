import { notFound } from "next/navigation";

import { createClient } from "@/core/supabase/server";
import { requireProjectPermission } from "@/core/rbac/can";
import { listProjectOrders } from "@/modules/procurement/order-data";
import { OrdersList } from "@/modules/procurement/components/orders-list";

/** A project's purchase orders (Procurement slice 5). */
export default async function ProjectOrdersPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  await requireProjectPermission(projectId, "procurement.order", "read");

  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("name")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) notFound();

  const orders = await listProjectOrders(projectId);

  return (
    <OrdersList projectId={projectId} projectName={project.name as string} orders={orders} />
  );
}
