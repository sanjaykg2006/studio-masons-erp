import "server-only";

import { createClient } from "@/core/supabase/server";
import type { ErrorSource } from "@/modules/errorlog/log";

/** One row of the error log, as shown in the UI. */
export type ErrorEntry = {
  id: string;
  occurred_at: string;
  source: ErrorSource;
  context: string;
  message: string;
  digest: string | null;
  detail: string | null;
  path: string | null;
  user_email: string | null;
  user_note: string | null;
};

/** A page of the log plus the total count (so every entry stays reachable). */
export type ErrorPage = { entries: ErrorEntry[]; total: number };

/**
 * Load a page of error entries (newest first), optionally filtered by source
 * ('client' | 'server'). RLS (errorlog:read) is the gate — returns empty for
 * anyone not allowed. Nothing is capped: the count lets the UI page through all.
 */
export async function getErrorLogs({
  source,
  page = 0,
  pageSize = 50,
}: { source?: ErrorSource; page?: number; pageSize?: number } = {}): Promise<ErrorPage> {
  const supabase = await createClient();
  let query = supabase
    .from("error_logs")
    .select(
      "id, occurred_at, source, context, message, digest, detail, path, user_email, user_note",
      { count: "exact" }
    )
    .order("occurred_at", { ascending: false });

  if (source) query = query.eq("source", source);

  const from = page * pageSize;
  const { data, count } = await query.range(from, from + pageSize - 1);
  return { entries: (data ?? []) as ErrorEntry[], total: count ?? 0 };
}
