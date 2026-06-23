import "server-only";

import { createAdminClient } from "@/core/supabase/admin";
import { getUser } from "@/core/auth/get-user";

/**
 * Record a sensitive action in the audit log.
 *
 * Writes through the service-role client so the row lands even though end users
 * have no INSERT rights on audit_log (that's what makes the trail tamper-proof).
 * Deliberately best-effort: a logging failure must never break the user-facing
 * action it accompanies, so errors are swallowed (and surfaced to the server
 * console) rather than thrown.
 *
 * @param action  machine code, e.g. "role.create", "user.invite"
 * @param summary human-readable description shown in the Activity Log
 * @param metadata structured extra detail (ids, before/after, ...)
 */
export async function logAudit(
  action: string,
  summary: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  try {
    const actor = await getUser();
    const admin = createAdminClient();
    await admin.from("audit_log").insert({
      actor_id: actor?.id ?? null,
      actor_email: actor?.email ?? null,
      action,
      summary,
      metadata,
    });
  } catch (err) {
    console.error("[audit] failed to record action", action, err);
  }
}
