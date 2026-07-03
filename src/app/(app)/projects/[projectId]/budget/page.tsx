import { notFound } from "next/navigation";

import { createClient } from "@/core/supabase/server";
import { requireProjectPermission, canOnProject } from "@/core/rbac/can";
import { getBudgetSpend, getProjectBudget } from "@/modules/procurement/budget-data";
import { BudgetBoq } from "@/modules/procurement/components/budget-boq";
import { BudgetImport } from "@/modules/procurement/components/budget-import";
import { BudgetSpendSummary } from "@/modules/procurement/components/budget-spend-summary";

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

  const [budget, spend, canCreate, canEdit, canApprove] = await Promise.all([
    getProjectBudget(projectId, v),
    getBudgetSpend(projectId),
    canOnProject(projectId, "procurement.budget", "create"),
    canOnProject(projectId, "procurement.budget", "update"),
    canOnProject(projectId, "procurement.budget", "approve"),
  ]);

  const showImport = canCreate && (!budget.current || budget.current.status === "released");
  // The headline only makes sense once a budget has been released (or something ordered).
  const showSpend = spend.budgetTotal > 0 || spend.expenditureTotal > 0;

  return (
    <div className="space-y-6">
      {showSpend && <BudgetSpendSummary spend={spend} />}
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
