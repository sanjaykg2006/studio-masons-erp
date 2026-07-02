"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/core/supabase/server";
import { logAudit } from "@/modules/audit/log";

export type ActionResult = { ok: true } | { ok: false; error: string };
const ok: ActionResult = { ok: true };
const fail = (error: string): ActionResult => ({ ok: false, error });

const refreshList = (projectId: string) => revalidatePath(`/projects/${projectId}/comparisons`);
const refreshOne = (projectId: string, comparisonId: string) =>
  revalidatePath(`/projects/${projectId}/comparisons/${comparisonId}`);

/** Start a comparison from a released budget package. Returns its id. */
export async function createComparison(
  projectId: string,
  packageId: string,
  title: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!packageId) return fail("Pick a package to compare.") as { ok: false; error: string };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_comparison", {
    p_project: projectId,
    p_package: packageId,
    p_title: title,
  });
  if (error) return { ok: false, error: error.message };
  await logAudit("procurement.comparison.create", "Started a comparison", { projectId });
  refreshList(projectId);
  return { ok: true, id: data as string };
}

export async function addComparisonVendor(
  projectId: string,
  comparisonId: string,
  vendorId: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_comparison_vendor", {
    p_comparison: comparisonId,
    p_vendor: vendorId,
  });
  if (error) return fail(error.message);
  refreshOne(projectId, comparisonId);
  return ok;
}

export async function removeComparisonVendor(
  projectId: string,
  comparisonId: string,
  vendorId: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_comparison_vendor", {
    p_comparison: comparisonId,
    p_vendor: vendorId,
  });
  if (error) return fail(error.message);
  refreshOne(projectId, comparisonId);
  return ok;
}

/** Enter or clear one vendor's rate on one line (null rate clears it). */
export async function setQuote(
  projectId: string,
  comparisonId: string,
  lineId: string,
  vendorId: string,
  rate: number | null,
  make: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_quote", {
    p_line: lineId,
    p_vendor: vendorId,
    p_rate: rate,
    p_make: make,
  });
  if (error) return fail(error.message);
  refreshOne(projectId, comparisonId);
  return ok;
}

/** Award lines to their winning vendors. awards = [{ line_id, vendor_id }]. */
export async function awardComparison(
  projectId: string,
  comparisonId: string,
  awards: { line_id: string; vendor_id: string }[]
): Promise<ActionResult> {
  if (awards.length === 0) return fail("Pick a winner for at least one line.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("award_comparison", {
    p_comparison: comparisonId,
    p_awards: awards,
  });
  if (error) return fail(error.message);
  await logAudit("procurement.comparison.award", "Awarded a comparison", { projectId, comparisonId });
  refreshOne(projectId, comparisonId);
  return ok;
}

/** Manually approve / remove a vendor for a project. */
export async function setProjectVendor(
  projectId: string,
  vendorId: string,
  approved: boolean
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_project_vendor", {
    p_project: projectId,
    p_vendor: vendorId,
    p_approved: approved,
  });
  if (error) return fail(error.message);
  refreshList(projectId);
  return ok;
}
