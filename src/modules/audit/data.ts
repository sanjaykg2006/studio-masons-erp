import "server-only";

import { createClient } from "@/core/supabase/server";

/** One row of the activity log, as shown in the UI. */
export type AuditEntry = {
  id: string;
  actor_email: string | null;
  action: string;
  summary: string;
  created_at: string;
};

/**
 * Load the most recent audit entries (newest first). Goes through the
 * authenticated server client, so RLS (audit:read) is the gate — anyone without
 * the permission, or before the migration is applied, simply gets an empty list
 * rather than an error.
 */
export async function getAuditData(limit = 100): Promise<AuditEntry[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("audit_log")
    .select("id, actor_email, action, summary, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? []) as AuditEntry[];
}
