import { notFound } from "next/navigation";

import { createClient } from "@/core/supabase/server";
import { requireProjectPermission, canOnProject } from "@/core/rbac/can";
import {
  listApprovedVendors,
  listProjectComparisons,
  listProjectVendors,
  listReleasedPackages,
} from "@/modules/procurement/comparison-data";
import { ComparisonsList } from "@/modules/procurement/components/comparisons-list";

/** A project's comparisons + approved-vendor list (Procurement slice 4). */
export default async function ProjectComparisonsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  await requireProjectPermission(projectId, "procurement.comparison", "read");

  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("name")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) notFound();

  const [comparisons, packages, projectVendors, approvedVendors, canCreate, canAward] =
    await Promise.all([
      listProjectComparisons(projectId),
      listReleasedPackages(projectId),
      listProjectVendors(projectId),
      listApprovedVendors(),
      canOnProject(projectId, "procurement.comparison", "create"),
      canOnProject(projectId, "procurement.comparison", "approve"),
    ]);

  return (
    <ComparisonsList
      projectId={projectId}
      projectName={project.name as string}
      comparisons={comparisons}
      packages={packages}
      projectVendors={projectVendors}
      approvedVendors={approvedVendors}
      canCreate={canCreate}
      canAward={canAward}
    />
  );
}
