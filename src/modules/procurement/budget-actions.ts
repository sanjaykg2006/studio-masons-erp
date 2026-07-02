"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/core/supabase/server";
import { authorizeProject } from "@/core/rbac/can";
import { logAudit } from "@/modules/audit/log";
import type { BudgetLineInput } from "@/modules/procurement/types";

export type ActionResult = { ok: true } | { ok: false; error: string };
const ok: ActionResult = { ok: true };
const fail = (error: string): ActionResult => ({ ok: false, error });

const refresh = (projectId: string) => revalidatePath(`/projects/${projectId}/budget`);

// ── Version lifecycle (RPCs enforce their own permission) ────────────────────

/** Start a project's first budget (draft v1). */
export async function startBudget(projectId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("start_budget", { p_project: projectId });
  if (error) return fail(error.message);
  await logAudit("procurement.budget.start", "Started a project budget", { projectId });
  refresh(projectId);
  return ok;
}

/** Release the working draft — locks it for ordering to reference. */
export async function releaseBudget(projectId: string, budgetId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("release_budget", { p_budget: budgetId });
  if (error) return fail(error.message);
  await logAudit("procurement.budget.release", "Released a budget version", { projectId, budgetId });
  refresh(projectId);
  return ok;
}

/** Open a fresh draft copied from the latest released version (needs approve). */
export async function newBudgetVersion(projectId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("new_budget_version", { p_project: projectId });
  if (error) return fail(error.message);
  await logAudit("procurement.budget.reversion", "Opened a new budget version", { projectId });
  refresh(projectId);
  return ok;
}

// ── Packages + lines (RLS-gated; guard first for a friendly message) ─────────

export async function addPackage(
  projectId: string,
  budgetId: string,
  name: string
): Promise<ActionResult> {
  if (!name.trim()) return fail("Enter a package name.");
  const denied = await authorizeProject(projectId, "procurement.budget", "update");
  if (denied) return denied;
  const supabase = await createClient();
  const { error } = await supabase
    .from("procurement_budget_packages")
    .insert({ budget_id: budgetId, name: name.trim() });
  if (error) return fail(error.message);
  refresh(projectId);
  return ok;
}

export async function renamePackage(
  projectId: string,
  packageId: string,
  name: string
): Promise<ActionResult> {
  if (!name.trim()) return fail("Enter a package name.");
  const denied = await authorizeProject(projectId, "procurement.budget", "update");
  if (denied) return denied;
  const supabase = await createClient();
  const { error } = await supabase
    .from("procurement_budget_packages")
    .update({ name: name.trim() })
    .eq("id", packageId);
  if (error) return fail(error.message);
  refresh(projectId);
  return ok;
}

export async function deletePackage(projectId: string, packageId: string): Promise<ActionResult> {
  const denied = await authorizeProject(projectId, "procurement.budget", "update");
  if (denied) return denied;
  const supabase = await createClient();
  const { error } = await supabase
    .from("procurement_budget_packages")
    .delete()
    .eq("id", packageId);
  if (error) return fail(error.message);
  refresh(projectId);
  return ok;
}

const lineColumns = (input: BudgetLineInput) => ({
  ref: input.ref.trim() || null,
  description: input.description.trim(),
  unit: input.unit.trim() || null,
  qty: Number.isFinite(input.qty) ? input.qty : 0,
  rate: Number.isFinite(input.rate) ? input.rate : 0,
});

export async function addLine(
  projectId: string,
  packageId: string,
  input: BudgetLineInput
): Promise<ActionResult> {
  if (!input.description.trim()) return fail("Enter a line description.");
  const denied = await authorizeProject(projectId, "procurement.budget", "update");
  if (denied) return denied;
  const supabase = await createClient();
  const { error } = await supabase
    .from("procurement_budget_lines")
    .insert({ package_id: packageId, ...lineColumns(input) });
  if (error) return fail(error.message);
  refresh(projectId);
  return ok;
}

export async function updateLine(
  projectId: string,
  lineId: string,
  input: BudgetLineInput
): Promise<ActionResult> {
  if (!input.description.trim()) return fail("Enter a line description.");
  const denied = await authorizeProject(projectId, "procurement.budget", "update");
  if (denied) return denied;
  const supabase = await createClient();
  const { error } = await supabase
    .from("procurement_budget_lines")
    .update(lineColumns(input))
    .eq("id", lineId);
  if (error) return fail(error.message);
  refresh(projectId);
  return ok;
}

export async function deleteLine(projectId: string, lineId: string): Promise<ActionResult> {
  const denied = await authorizeProject(projectId, "procurement.budget", "update");
  if (denied) return denied;
  const supabase = await createClient();
  const { error } = await supabase.from("procurement_budget_lines").delete().eq("id", lineId);
  if (error) return fail(error.message);
  refresh(projectId);
  return ok;
}
