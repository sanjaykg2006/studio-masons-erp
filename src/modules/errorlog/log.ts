import "server-only";

import { createAdminClient } from "@/core/supabase/admin";
import { getUser } from "@/core/auth/get-user";

/** What broke: a page on the website ('client') or backend code ('server'). */
export type ErrorSource = "client" | "server";

export type RecordErrorInput = {
  source: ErrorSource;
  /** Where it happened, e.g. "app", "global", "server render", "finance action". */
  context: string;
  /** The human-readable error message. */
  message: string;
  /** Next.js error id shown to the user (lets you match a report to a row). */
  digest?: string | null;
  /** Stack trace or extra technical detail for a developer. */
  detail?: string | null;
  /** URL/route where it happened. */
  path?: string | null;
};

/**
 * Save one entry in the Error Log.
 *
 * Writes through the service-role client so the row lands even though end users
 * have no INSERT rights on error_logs (that's what keeps the log trustworthy).
 * Deliberately best-effort: a logging failure must never break — or mask — the
 * thing it is recording, so errors here are swallowed to the server console.
 */
export async function recordError(input: RecordErrorInput): Promise<void> {
  try {
    // Snapshot who hit it, when a session is available (crashes can be anonymous).
    let userId: string | null = null;
    let userEmail: string | null = null;
    try {
      const user = await getUser();
      userId = user?.id ?? null;
      userEmail = user?.email ?? null;
    } catch {
      // No/!broken session — record the error anyway, just without the person.
    }

    const admin = createAdminClient();
    await admin.from("error_logs").insert({
      source: input.source,
      context: input.context.slice(0, 200),
      message: (input.message || "Unknown error").slice(0, 2000),
      digest: input.digest ?? null,
      detail: input.detail ? input.detail.slice(0, 8000) : null,
      path: input.path ?? null,
      user_id: userId,
      user_email: userEmail,
    });
  } catch (err) {
    console.error("[errorlog] failed to record error", input.context, err);
  }
}
