import "server-only";

import { createClient } from "@/core/supabase/server";
import { can } from "@/core/rbac/permissions";
import type { PettyCashCategory, PettyCashEntry, ProjectOption } from "@/modules/pettycash/types";

export async function listPettyCashEntries(): Promise<PettyCashEntry[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("list_pettycash_entries");
  return (data ?? []) as PettyCashEntry[];
}

/** Whether the caller sees everyone's entries, not just their own: "See all
 * claims" or Pay — the same rule as pettycash_sees_all(). Whoever an approval
 * stage is waiting on sees that one claim through its own policy. */
export async function canSeeAllPettyCash(): Promise<boolean> {
  const checks = await Promise.all([
    can("pettycash.entry", "read"),
    can("pettycash.pay", "issue"),
  ]);
  return checks.some(Boolean);
}

export async function listPettyCashCategories(activeOnly = false): Promise<PettyCashCategory[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("list_pettycash_categories", { p_active_only: activeOnly });
  return (data ?? []) as PettyCashCategory[];
}

/** Projects the caller can see (RLS-gated), for the optional project tag. */
export async function listVisibleProjects(): Promise<ProjectOption[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("projects").select("id, name").order("name");
  return (data ?? []) as ProjectOption[];
}
