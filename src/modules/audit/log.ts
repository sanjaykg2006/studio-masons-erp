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

    // Snapshot the actor's name so the log reads by person (email is the fallback).
    let actorName: string | null = null;
    if (actor?.id) {
      const { data } = await admin
        .from("profiles")
        .select("full_name")
        .eq("id", actor.id)
        .maybeSingle();
      actorName = (data as { full_name: string | null } | null)?.full_name ?? null;
    }

    // Tag the entry with a department so the log can be viewed per department:
    // an explicit departmentId if the action carried one, else the linked
    // project's department. NULL = a company-wide action (roles, users, …).
    let departmentId: string | null =
      typeof metadata.departmentId === "string" ? metadata.departmentId : null;
    if (!departmentId && typeof metadata.projectId === "string") {
      const { data } = await admin
        .from("projects")
        .select("department_id")
        .eq("id", metadata.projectId)
        .maybeSingle();
      departmentId = (data as { department_id: string | null } | null)?.department_id ?? null;
    }

    await admin.from("audit_log").insert({
      actor_id: actor?.id ?? null,
      actor_email: actor?.email ?? null,
      actor_name: actorName,
      action,
      summary,
      metadata,
      department_id: departmentId,
    });
  } catch (err) {
    console.error("[audit] failed to record action", action, err);
  }
}
