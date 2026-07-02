import { notFound } from "next/navigation";

import { requireProjectPermission } from "@/core/rbac/can";
import { getComparison, listApprovedVendors } from "@/modules/procurement/comparison-data";
import { ComparisonGrid } from "@/modules/procurement/components/comparison-detail";

/** One comparison's grid (Procurement slice 4). */
export default async function ComparisonPage({
  params,
}: {
  params: Promise<{ projectId: string; comparisonId: string }>;
}) {
  const { projectId, comparisonId } = await params;
  await requireProjectPermission(projectId, "procurement.comparison", "read");

  const [comparison, approvedVendors] = await Promise.all([
    getComparison(projectId, comparisonId),
    listApprovedVendors(),
  ]);
  if (!comparison) notFound();

  return (
    <ComparisonGrid
      projectId={projectId}
      comparison={comparison}
      approvedVendors={approvedVendors}
    />
  );
}
