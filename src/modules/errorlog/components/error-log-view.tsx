import Link from "next/link";

import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { errorActor, sourceLabel } from "@/modules/errorlog/format";
import type { ErrorEntry } from "@/modules/errorlog/data";

/**
 * Read-only view of the error log. Server-rendered — receives an already-loaded
 * page of entries plus the source filter + paging state. The filter/pager are
 * plain links (URL search params) and each row's technical detail lives in a
 * native <details>, so no client-side state is needed.
 */
export function ErrorLogView({
  entries,
  total,
  page,
  pageSize,
  source,
}: {
  entries: ErrorEntry[];
  total: number;
  page: number;
  pageSize: number;
  /** Active filter: "client", "server", or undefined (all). */
  source?: string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);

  const href = (next: { source?: string; page?: number }) => {
    const params = new URLSearchParams();
    const s = "source" in next ? next.source : source;
    const p = "page" in next ? next.page : page;
    if (s) params.set("source", s);
    if (p && p > 0) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/logs?${qs}` : "/logs";
  };

  const tabs: { key: string | undefined; label: string }[] = [
    { key: undefined, label: "All" },
    { key: "client", label: "Website" },
    { key: "server", label: "Backend" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Error Log</h1>
        <p className="text-muted-foreground">
          Technical failures — page crashes on the website and unexpected backend
          errors — with the detail a developer needs to fix them.
        </p>
      </div>

      {/* Source filter ------------------------------------------------------- */}
      <div className="flex flex-wrap gap-1">
        {tabs.map((t) => {
          const active = t.key === source || (t.key === undefined && !source);
          return (
            <Link
              key={t.key ?? "all"}
              href={href({ source: t.key, page: 0 })}
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
            {source === "client"
              ? "Website crashes"
              : source === "server"
                ? "Backend errors"
                : "All errors"}
          </CardTitle>
          <CardDescription>
            {total === 0
              ? "Nothing recorded — that's good news."
              : `Showing ${from}–${to} of ${total} errors, newest first.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No errors have been recorded here yet.
            </p>
          ) : (
            <div className="space-y-2">
              {entries.map((e) => (
                <details key={e.id} className="group rounded-md border px-3 py-2">
                  <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <span
                      className={cn(
                        "rounded px-2 py-0.5 text-xs font-medium",
                        e.source === "server"
                          ? "bg-destructive/10 text-destructive"
                          : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                      )}
                    >
                      {sourceLabel(e.source)}
                    </span>
                    <span className="text-muted-foreground whitespace-nowrap">
                      {new Date(e.occurred_at).toLocaleString("en-GB")}
                    </span>
                    <span className="font-medium">{e.message}</span>
                    <span className="text-muted-foreground ml-auto text-xs">
                      {e.context}
                    </span>
                  </summary>

                  <dl className="text-muted-foreground mt-2 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-xs">
                    <dt>Who</dt>
                    <dd>{errorActor(e.user_email)}</dd>
                    {e.path && (
                      <>
                        <dt>Screen / route</dt>
                        <dd className="font-mono break-all">{e.path}</dd>
                      </>
                    )}
                    {e.digest && (
                      <>
                        <dt>Reference</dt>
                        <dd className="font-mono">{e.digest}</dd>
                      </>
                    )}
                    {e.detail && (
                      <>
                        <dt>Detail</dt>
                        <dd>
                          <pre className="bg-muted max-h-64 overflow-auto rounded p-2 font-mono text-[11px] whitespace-pre-wrap">
                            {e.detail}
                          </pre>
                        </dd>
                      </>
                    )}
                  </dl>
                </details>
              ))}
            </div>
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
