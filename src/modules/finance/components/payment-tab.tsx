"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  PAYMENT_STATUS_LABEL,
  PRIORITY_LABEL,
  inr,
  type PaymentStatus,
  type PaymentSummary,
} from "@/modules/finance/types";
import { decidePayment, markPaymentPaid } from "@/modules/finance/actions";

type Result = { ok: true } | { ok: false; error: string };

const STATUS_TONE: Record<PaymentStatus, string> = {
  pending_director: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  approved: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  paid: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  rejected: "bg-destructive/10 text-destructive",
};

const PRIORITY_TONE: Record<string, string> = {
  high: "text-destructive",
  medium: "text-amber-600 dark:text-amber-400",
  low: "text-muted-foreground",
};

export function PaymentTab({
  projectId,
  payments,
}: {
  projectId: string;
  payments: PaymentSummary[];
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
        A request to pay an approved invoice. Director approves, then Accounts marks it paid.
      </p>

      {error && (
        <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-md border px-4 py-2 text-sm">
          {error}
        </div>
      )}

      <Card>
        <CardContent className="pt-6">
          {payments.length === 0 ? (
            <p className="text-muted-foreground text-sm">No payment requests yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-left">
                    <th className="py-2 font-medium">Invoice</th>
                    <th className="py-2 font-medium">Vendor</th>
                    <th className="py-2 font-medium">Amount</th>
                    <th className="py-2 font-medium">Priority</th>
                    <th className="py-2 font-medium">Status</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} className="border-b last:border-0">
                      <td className="py-2 font-medium">{p.invoice_no}</td>
                      <td className="text-muted-foreground py-2">{p.vendor_name}</td>
                      <td className="py-2">{inr(p.amount)}</td>
                      <td className={cn("py-2 text-xs font-medium", PRIORITY_TONE[p.priority])}>
                        {PRIORITY_LABEL[p.priority] ?? p.priority}
                      </td>
                      <td className="py-2">
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-medium",
                            STATUS_TONE[p.status]
                          )}
                        >
                          {PAYMENT_STATUS_LABEL[p.status]}
                        </span>
                        {p.status === "pending_director" && p.stage_label && (
                          <span className="text-muted-foreground block text-[10px]">
                            waiting for {p.stage_label}
                          </span>
                        )}
                      </td>
                      <td className="py-2">
                        <div className="flex items-center justify-end gap-1">
                          {p.status === "pending_director" && p.can_approve && p.approval_id && (
                            <>
                              <Button
                                size="sm"
                                disabled={pending}
                                title={p.stage_label ?? undefined}
                                onClick={() => run(() => decidePayment(projectId, p.approval_id!, true, ""))}
                              >
                                <Check className="size-4" /> Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={pending}
                                onClick={() => {
                                  const note = prompt("Reject this payment request — reason?");
                                  if (note === null) return;
                                  run(() => decidePayment(projectId, p.approval_id!, false, note));
                                }}
                              >
                                Reject
                              </Button>
                            </>
                          )}
                          {p.status === "approved" && p.can_pay && (
                            <Button size="sm" disabled={pending} onClick={() => run(() => markPaymentPaid(projectId, p.id))}>
                              Mark paid
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
