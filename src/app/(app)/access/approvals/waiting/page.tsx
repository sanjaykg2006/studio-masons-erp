import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { requirePermission } from "@/core/rbac/can";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { listWaitingApprovals, waitingItemHref } from "@/modules/access/approval-data";
import { STALE_DAYS } from "@/modules/access/waiting";

const inr = (n: number) => `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/**
 * Waiting approvals — every item waiting on a decision, who can give it right
 * now, and how long it has waited. Stuck ones (nobody but an administrator can
 * give the stage, or it has waited a week) come first.
 */
export default async function WaitingApprovalsPage() {
  await requirePermission("access", "read");
  const waiting = await listWaitingApprovals();
  const sorted = [...waiting].sort(
    (a, b) => Number(b.stuck) - Number(a.stuck) || a.waiting_since.localeCompare(b.waiting_since)
  );
  const stuck = waiting.filter((w) => w.stuck).length;

  return (
    <div className="space-y-6">
      <Link
        href="/access/approvals"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" /> Approval flows
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Waiting approvals</h1>
        <p className="text-muted-foreground">
          Everything waiting on an approval decision, and who it is waiting on.
          Marked <span className="font-medium text-red-700 dark:text-red-400">stuck</span> when
          nobody can approve it, or it has waited {STALE_DAYS} days or more.
        </p>
      </div>

      {waiting.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing is waiting for approval.</p>
      ) : (
        <p className="text-sm">
          {waiting.length} waiting{stuck > 0 && <> · <span className="font-medium text-red-700 dark:text-red-400">{stuck} stuck</span></>}
        </p>
      )}

      <div className="space-y-3">
        {sorted.map((w) => {
          const days = w.days_waiting;
          const nobody = w.can_approve.length === 0;
          const flagged = w.stuck;
          return (
            <Card key={w.id} className={cn(flagged && "border-red-300 dark:border-red-900")}>
              <CardContent className="space-y-2 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {w.flow_label}
                      {w.item_ref && <span className="text-muted-foreground font-normal"> · {w.item_ref}</span>}
                      {flagged && (
                        <span className="ml-2 rounded bg-red-500/15 px-1.5 py-0.5 text-xs font-normal text-red-700 dark:text-red-400">
                          stuck
                        </span>
                      )}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {w.project_label ? `${w.project_label} · ` : ""}
                      Raised by {w.requester_name ?? "—"}
                      {w.amount != null && ` · ${inr(w.amount)}`}
                    </p>
                  </div>
                  <Link href={waitingItemHref(w)} className="shrink-0 text-xs underline underline-offset-2">
                    Open →
                  </Link>
                </div>

                <p className="text-xs">
                  <span className="text-muted-foreground">
                    Step {w.stage_no} of {w.stage_count}:{" "}
                  </span>
                  <span className="font-medium">{w.stage_label}</span>
                  {w.approver_label && <span className="text-muted-foreground"> — given by {w.approver_label}</span>}
                </p>

                <p className={cn("text-xs", days >= STALE_DAYS && "font-medium text-red-700 dark:text-red-400")}>
                  Waiting {days === 0 ? "since today" : `${days} day${days === 1 ? "" : "s"}`}
                </p>

                {nobody ? (
                  <p className="text-xs font-medium text-red-700 dark:text-red-400">
                    Nobody can approve this step.{" "}
                    {w.admin_backup.length > 0
                      ? `Only an administrator override: ${w.admin_backup.join(", ")}.`
                      : "No administrator can step in either: they raised it or gave an earlier step."}{" "}
                    Give someone the role on Approval flows, or pick a different role for the step.
                  </p>
                ) : (
                  <p className="text-xs">
                    <span className="text-muted-foreground">Can approve now: </span>
                    {w.can_approve.join(", ")}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
