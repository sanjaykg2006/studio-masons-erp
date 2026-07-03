import "server-only";

import { createClient } from "@/core/supabase/server";
import type {
  BudgetDetail,
  BudgetPackage,
  BudgetSpend,
  BudgetVersion,
  ProjectBudget,
} from "@/modules/procurement/types";

type RawLine = {
  id: string;
  ref: string | null;
  description: string;
  unit: string | null;
  qty: number;
  rate: number;
  amount: number;
  sort: number;
};
type RawPackage = { id: string; name: string; sort: number; procurement_budget_lines: RawLine[] };
type RawBudget = {
  id: string;
  version_no: number;
  status: "draft" | "released";
  released_at: string | null;
  created_at: string;
  notes: string | null;
  procurement_budget_packages: RawPackage[];
};

/**
 * A project's Budget BOQ: the list of versions, plus one fully-loaded version
 * (its packages and lines). Defaults to the working draft, else the latest
 * released version; `budgetId` picks a specific one. All RLS-gated by
 * procurement.budget:read.
 */
export async function getProjectBudget(
  projectId: string,
  budgetId?: string
): Promise<ProjectBudget> {
  const supabase = await createClient();

  const { data: versionRows } = await supabase
    .from("procurement_budgets")
    .select("id, version_no, status, released_at, created_at")
    .eq("project_id", projectId)
    .order("version_no", { ascending: false });

  const versions = (versionRows ?? []) as BudgetVersion[];
  if (versions.length === 0) return { versions: [], current: null };

  const pick =
    (budgetId && versions.find((v) => v.id === budgetId)) ||
    versions.find((v) => v.status === "draft") ||
    versions[0];

  const { data: fullRaw } = await supabase
    .from("procurement_budgets")
    .select(
      "id, version_no, status, released_at, created_at, notes, " +
        "procurement_budget_packages(id, name, sort, " +
        "procurement_budget_lines(id, ref, description, unit, qty, rate, amount, sort))"
    )
    .eq("id", pick.id)
    .single();

  const full = fullRaw as unknown as RawBudget | null;
  if (!full) return { versions, current: null };

  const packages: BudgetPackage[] = (full.procurement_budget_packages ?? [])
    .map((p) => ({
      id: p.id,
      name: p.name,
      sort: p.sort,
      lines: (p.procurement_budget_lines ?? [])
        .map((l) => ({
          id: l.id,
          ref: l.ref,
          description: l.description,
          unit: l.unit,
          qty: Number(l.qty),
          rate: Number(l.rate),
          amount: Number(l.amount),
          sort: l.sort,
        }))
        .sort((a, b) => a.sort - b.sort || a.description.localeCompare(b.description)),
    }))
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));

  const current: BudgetDetail = {
    id: full.id,
    version_no: full.version_no,
    status: full.status,
    released_at: full.released_at,
    created_at: full.created_at,
    notes: full.notes,
    packages,
  };

  return { versions, current };
}

/**
 * The project-level headline: the latest released budget's total value against the
 * value ordered on live purchase orders (issued + closed). RLS-gated by
 * procurement.budget:read via the RPC. Both default to 0 when there's nothing yet.
 */
export async function getBudgetSpend(projectId: string): Promise<BudgetSpend> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("project_budget_vs_expenditure", {
    p_project: projectId,
  });
  const row = ((data ?? []) as { budget_total: number; expenditure_total: number }[])[0];
  return {
    budgetTotal: Number(row?.budget_total ?? 0),
    expenditureTotal: Number(row?.expenditure_total ?? 0),
  };
}
