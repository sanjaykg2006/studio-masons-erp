import { notFound } from "next/navigation";

import { createClient } from "@/core/supabase/server";
import { requireProjectPermission, canOnProject } from "@/core/rbac/can";
import { getProjectBudget } from "@/modules/procurement/budget-data";
import { BudgetBoq } from "@/modules/procurement/components/budget-boq";
import { BudgetImport } from "@/modules/procurement/components/budget-import";

/** A project's Budget BOQ (Procurement slice 2). */
export default async function ProjectBudgetPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const { projectId } = await params;
  const { v } = await searchParams;
  await requireProjectPermission(projectId, "procurement.budget", "read");

  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("name")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) notFound();

  const [budget, canCreate, canEdit, canApprove] = await Promise.all([
    getProjectBudget(projectId, v),
    canOnProject(projectId, "procurement.budget", "create"),
    canOnProject(projectId, "procurement.budget", "update"),
    canOnProject(projectId, "procurement.budget", "approve"),
  ]);

  const showImport = canCreate && (!budget.current || budget.current.status === "released");

  return (
    <div className="space-y-6">
      <BudgetBoq
        projectId={projectId}
        projectName={project.name as string}
        budget={budget}
        canCreate={canCreate}
        canEdit={canEdit}
        canApprove={canApprove}
      />
      {showImport && <BudgetImport projectId={projectId} />}
    </div>
  );
}
