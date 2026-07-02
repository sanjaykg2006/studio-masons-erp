import Link from "next/link";

import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { actionLabel, actorLabel } from "@/modules/audit/format";
import type { AuditDepartment, AuditEntry } from "@/modules/audit/data";

/**
 * Read-only view of the audit trail. Server-rendered — receives an already-loaded
 * page of entries plus the department filter + paging state, and formats them. The
 * filter/pager are plain links (URL search params), so no client state is needed.
 */
export function AuditView({
  entries,
  departments,
  total,
  page,
  pageSize,
  scope,
}: {
  entries: AuditEntry[];
  departments: AuditDepartment[];
  total: number;
  page: number;
  pageSize: number;
  /** Active filter: a department id, "general", or undefined (all). */
  scope?: string;
}) {
  const deptName = new Map(departments.map((d) => [d.id, d.label]));
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);

  // Build a filter/pager href, keeping the other param.
  const href = (next: { scope?: string; page?: number }) => {
    const params = new URLSearchParams();
    const s = "scope" in next ? next.scope : scope;
    const p = "page" in next ? next.page : page;
    if (s) params.set("dept", s);
    if (p && p > 0) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/audit?${qs}` : "/audit";
  };

  const tabs: { key: string | undefined; label: string }[] = [
    { key: undefined, label: "All" },
    { key: "general", label: "Company-wide" },
    ...departments.map((d) => ({ key: d.id, label: d.label })),
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Activity Log</h1>
        <p className="text-muted-foreground">
          A record of sensitive changes — who did what, and when.
        </p>
      </div>

      {/* Department filter ---------------------------------------------------- */}
      <div className="flex flex-wrap gap-1">
        {tabs.map((t) => {
          const active = t.key === scope || (t.key === undefined && !scope);
          return (
            <Link
              key={t.key ?? "all"}
              href={href({ scope: t.key, page: 0 })}
              className={cn(
                "rounded-md border px-3 py-1 text-sm",
                active
                  ? "bg-primary text-primary-foreground border-primary"
                  : "hover:bg-accent/50"
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {!scope
              ? "All activity"
              : scope === "general"
                ? "Company-wide activity"
                : `${deptName.get(scope) ?? "Department"} activity`}
          </CardTitle>
          <CardDescription>
            {total === 0
              ? "Nothing recorded yet."
              : `Showing ${from}–${to} of ${total} events, newest first.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No activity has been recorded here yet.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left">
                  <th className="py-2 font-medium">When</th>
                  <th className="py-2 font-medium">Who</th>
                  <th className="py-2 font-medium">Where</th>
                  <th className="py-2 font-medium">Action</th>
                  <th className="py-2 font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-b last:border-0 align-top">
                    <td className="text-muted-foreground py-2 whitespace-nowrap">
                      {new Date(e.created_at).toLocaleString("en-GB")}
                    </td>
                    <td className="py-2">{actorLabel(e.actor_name, e.actor_email)}</td>
                    <td className="text-muted-foreground py-2 whitespace-nowrap">
                      {e.department_id ? deptName.get(e.department_id) ?? "—" : "Company-wide"}
                    </td>
                    <td className="py-2">
                      <span className="bg-accent text-accent-foreground rounded px-2 py-0.5 text-xs">
                        {actionLabel(e.action)}
                      </span>
                    </td>
                    <td className="py-2">{e.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Pager — every entry stays reachable ------------------------------ */}
          {total > pageSize && (
            <div className="mt-4 flex items-center justify-between text-sm">
              {page > 0 ? (
                <Link href={href({ page: page - 1 })} className="hover:bg-accent/50 rounded-md border px-3 py-1">
                  ← Newer
                </Link>
              ) : (
                <span className="text-muted-foreground rounded-md border px-3 py-1 opacity-50">← Newer</span>
              )}
              <span className="text-muted-foreground">
                Page {page + 1} of {totalPages}
              </span>
              {page + 1 < totalPages ? (
                <Link href={href({ page: page + 1 })} className="hover:bg-accent/50 rounded-md border px-3 py-1">
                  Older →
                </Link>
              ) : (
                <span className="text-muted-foreground rounded-md border px-3 py-1 opacity-50">Older →</span>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
