import "server-only";

import { createClient } from "@/core/supabase/server";

/** Why an item was last turned down, while it stands rejected. */
export type RejectionNote = { note: string | null; by: string | null; at: string };

/**
 * The latest rejection reason for each of `itemIds` on one approval flow,
 * keyed by item id. Items that aren't currently rejected are left out.
 */
export async function getRejectionNotes(
  flow: string,
  itemIds: string[]
): Promise<Record<string, RejectionNote>> {
  if (!itemIds.length) return {};
  const supabase = await createClient();
  const { data } = await supabase.rpc("approval_rejection_notes", {
    p_flow: flow,
    p_items: itemIds,
  });
  const out: Record<string, RejectionNote> = {};
  for (const r of (data ?? []) as {
    item_id: string;
    note: string | null;
    decided_by_name: string | null;
    decided_at: string;
  }[]) {
    out[r.item_id] = { note: r.note, by: r.decided_by_name, at: r.decided_at };
  }
  return out;
}
