import "server-only";

import { createClient } from "@/core/supabase/server";
import type { Intent, ReleasedBudgetLine } from "@/modules/procurement/types";

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
