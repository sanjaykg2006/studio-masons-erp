import "server-only";

import { createAdminClient } from "@/core/supabase/admin";
import { createClient } from "@/core/supabase/server";
import { namePerson } from "@/modules/audit/format";

/** One row of the activity log, as shown in the UI. */
export type AuditEntry = {
  id: string;
  actor_name: string | null;
  actor_email: string | null;
  action: string;
  summary: string;
  created_at: string;
  department_id: string | null;
};

/** A page of the log plus the total count (so every log stays reachable). */
export type AuditPage = { entries: AuditEntry[]; total: number };

/** A department option for the log's filter. */
export type AuditDepartment = { id: string; label: string };

/**
 * Load a page of audit entries (newest first), optionally scoped to a department.
 * `scope` = a department id, "general" (company-wide/untagged), or undefined (all).
 * Returns the total count too, so the UI can page through EVERY entry — nothing is
 * capped or dropped. RLS (audit:read) is the gate; an empty list otherwise.
 */
export async function getAuditData({
  scope,
  page = 0,
  pageSize = 100,
}: { scope?: string; page?: number; pageSize?: number } = {}): Promise<AuditPage> {
  const supabase = await createClient();
  let query = supabase
    .from("audit_log")
    .select("id, actor_name, actor_email, action, summary, metadata, created_at, department_id", {
      count: "exact",
    })
    .order("created_at", { ascending: false });

  if (scope === "general") query = query.is("department_id", null);
  else if (scope) query = query.eq("department_id", scope);

  const from = page * pageSize;
  const { data, count } = await query.range(from, from + pageSize - 1);
  const rows = (data ?? []) as (AuditEntry & { metadata: Record<string, unknown> | null })[];

  // Older entries said "a teammate" / "a user" and kept only the person's id.
  // Look those people up so every entry reads by name. The admin client, as an
  // audit reader may not hold Access Control (profiles' read rule) — they only
  // get names for people on rows RLS already let them see.
  const ids = [
    ...new Set(
      rows
        .filter((r) => typeof r.metadata?.personName !== "string")
        .map((r) => r.metadata?.userId)
        .filter((id): id is string => typeof id === "string")
    ),
  ];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: people } = await createAdminClient()
      .from("profiles")
      .select("id, full_name, email")
      .in("id", ids);
    for (const p of (people ?? []) as { id: string; full_name: string | null; email: string | null }[]) {
      const name = p.full_name?.trim() || p.email;
      if (name) names.set(p.id, name);
    }
  }

  const entries: AuditEntry[] = rows.map(({ metadata, ...r }) => {
    const named =
      typeof metadata?.personName === "string"
        ? metadata.personName
        : typeof metadata?.userId === "string"
          ? (names.get(metadata.userId) ?? null)
          : null;
    return { ...r, summary: namePerson(r.summary, named) };
  });
  return { entries, total: count ?? 0 };
}

/** Departments to offer in the log's filter (admins can read them all). */
export async function listAuditDepartments(): Promise<AuditDepartment[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("departments").select("id, label").order("label");
  return (data ?? []) as AuditDepartment[];
}
