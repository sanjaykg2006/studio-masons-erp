"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { inr, type RetentionRow } from "@/modules/finance/types";
import {
  approveEarlyRetention,
  markRetentionPaid,
  requestEarlyRetention,
} from "@/modules/finance/actions";

type Result = { ok: true } | { ok: false; error: string };

export function RetentionTab({
  projectId,
  retention,
}: {
  projectId: string;
  retention: RetentionRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<Result>) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error);
      else router.refresh();
    });

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        5% held on each invoice, released after 12 months. Accounts pays it when it matures;
        early release needs a Director request and MD approval.
      </p>

      {error && (
        <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-md border px-4 py-2 text-sm">
          {error}
        </div>
      )}

      <Card>
        <CardContent className="pt-6">
          {retention.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nothing held in retention yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-left">
                    <th className="py-2 font-medium">Invoice</th>
                    <th className="py-2 font-medium">Vendor</th>
                    <th className="py-2 font-medium">Amount</th>
                    <th className="py-2 font-medium">Due</th>
                    <th className="py-2 font-medium">State</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {retention.map((r) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="py-2 font-medium">{r.invoice_no}</td>
                      <td className="text-muted-foreground py-2">{r.vendor_name}</td>
                      <td className="py-2">{inr(r.amount)}</td>
                      <td className="text-muted-foreground py-2">{r.due_date}</td>
                      <td className="py-2">
                        {r.status === "paid" ? (
                          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                            Paid
                          </span>
                        ) : r.is_due ? (
                          <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-400">
                            {r.early_approved ? "Early release approved" : "Due to pay"}
                          </span>
                        ) : r.early_requested ? (
                          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                            Early release requested
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-[10px]">Held</span>
                        )}
                      </td>
                      <td className="py-2">
                        <div className="flex items-center justify-end gap-1">
                          {r.status === "held" && r.is_due && r.can_pay && (
                            <Button size="sm" disabled={pending} onClick={() => run(() => markRetentionPaid(projectId, r.id))}>
                              Mark paid
                            </Button>
                          )}
                          {r.status === "held" && !r.is_due && !r.early_requested && r.can_request_early && (
                            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => requestEarlyRetention(projectId, r.id))}>
                              Request early
                            </Button>
                          )}
                          {r.status === "held" && r.early_requested && !r.early_approved && r.can_approve_early && (
                            <Button size="sm" disabled={pending} onClick={() => run(() => approveEarlyRetention(projectId, r.id))}>
                              Approve early (MD)
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
