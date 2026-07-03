import "server-only";

import { createClient } from "@/core/supabase/server";
import type {
  Intent,
  OpenIntentLine,
  ReleasedBudgetLine,
  Vendor,
} from "@/modules/procurement/types";

/** The purchase intents on a project (RLS-gated by procurement.intent:read). */
export async function listProjectIntents(projectId: string): Promise<Intent[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("list_project_intents", { p_project: projectId });
  return (data ?? []) as Intent[];
}

/** The released budget's lines, for the "raise intent" picker. Empty until a
 * budget version has been released. */
export async function listReleasedBudgetLines(
  projectId: string
): Promise<ReleasedBudgetLine[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("list_released_budget_lines", { p_project: projectId });
  return (data ?? []) as ReleasedBudgetLine[];
}

/** An approved intent's header, for the "enter vendor rates" screen. Returns null
 * unless the intent belongs to this project and the caller can read it. */
export async function getIntentForOrder(
  projectId: string,
  intentId: string
): Promise<{ status: string; needed_by: string | null; notes: string | null } | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("procurement_intents")
    .select("project_id, status, needed_by, notes")
    .eq("id", intentId)
    .maybeSingle();
  const row = data as { project_id: string; status: string; needed_by: string | null; notes: string | null } | null;
  if (!row || row.project_id !== projectId) return null;
  return { status: row.status, needed_by: row.needed_by, notes: row.notes };
}

/** The approved-intent lines still awaiting a vendor (open quantity > 0). */
export async function listIntentOpenLines(intentId: string): Promise<OpenIntentLine[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("list_intent_open_lines", { p_intent: intentId });
  return (data ?? []) as OpenIntentLine[];
}

/** Approved vendors from the global directory, for the vendor picker. */
export async function listApprovedVendors(): Promise<Vendor[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("list_vendors");
  return ((data ?? []) as Vendor[]).filter((v) => v.status === "approved");
}
