import { notFound } from "next/navigation";

import { createClient } from "@/core/supabase/server";
import { requireProjectPermission } from "@/core/rbac/can";
import {
  getIntentForOrder,
  listApprovedVendors,
  listIntentOpenLines,
} from "@/modules/procurement/intent-data";
import { EnterVendorRates } from "@/modules/procurement/components/enter-vendor-rates";

/** Enter the chosen vendor's rate per line on an approved intent, then generate
 * the purchase orders (Procurement Manager — procurement.order:issue). */
export default async function EnterVendorRatesPage({
  params,
}: {
  params: Promise<{ projectId: string; intentId: string }>;
}) {
  const { projectId, intentId } = await params;
  await requireProjectPermission(projectId, "procurement.order", "issue");

  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("name")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) notFound();

  const intent = await getIntentForOrder(projectId, intentId);
  if (!intent) notFound();

  const [openLines, vendors] = await Promise.all([
    listIntentOpenLines(intentId),
    listApprovedVendors(),
  ]);

  return (
    <EnterVendorRates
      projectId={projectId}
      intentId={intentId}
      projectName={project.name as string}
      approved={intent.status === "approved"}
      openLines={openLines}
      vendors={vendors}
    />
  );
}
