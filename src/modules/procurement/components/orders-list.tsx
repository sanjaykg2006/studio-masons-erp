"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowLeft } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ORDER_STATUS_LABEL,
  type ComparisonSummary,
  type OrderStatus,
  type OrderSummary,
} from "@/modules/procurement/types";
import { createOrdersFromComparison } from "@/modules/procurement/order-actions";

type Result = { ok: true } | { ok: false; error: string };

const STATUS_TONE: Record<OrderStatus, string> = {
  draft: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  issued: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  closed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
};

const fmt = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function OrdersList({
  projectId,
  projectName,
  orders,
  awardedComparisons,
  canIssue,
}: {
  projectId: string;
  projectName: string;
  orders: OrderSummary[];
  awardedComparisons: ComparisonSummary[];
  canIssue: boolean;
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
    <div className="space-y-6">
      <Link
        href={`/projects/${projectId}`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" /> {projectName}
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Purchase orders</h1>
        <p className="text-muted-foreground">
          One PO per awarded vendor. Finance and the Director sign off, then the
          Procurement Manager releases it; goods are received against it.
        </p>
      </div>

      {error && (
        <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-md border px-4 py-2 text-sm">
          {error}
        </div>
      )}

      {canIssue && awardedComparisons.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Awarded comparisons</CardTitle>
            <CardDescription>Create the purchase orders for each awarded vendor.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {awardedComparisons.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
                  <span>{c.title || c.package_name || "Comparison"}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => run(() => createOrdersFromComparison(projectId, c.id))}
                  >
                    Create POs
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          {orders.length === 0 ? (
            <p className="text-muted-foreground text-sm">No purchase orders yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left text-xs">
                  <th className="py-2 font-medium">PO</th>
                  <th className="py-2 font-medium">Vendor</th>
                  <th className="py-2 font-medium">Sign-off</th>
                  <th className="py-2 text-right font-medium">Total</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-b last:border-0">
                    <td className="py-2 font-medium">
                      <Link href={`/projects/${projectId}/orders/${o.id}`} className="hover:underline">
                        {o.po_number ?? "PO"}
                      </Link>
                    </td>
                    <td className="py-2">{o.vendor_name}</td>
                    <td className="text-muted-foreground py-2 text-xs">
                      <span className={cn(o.finance_reviewed_by ? "text-emerald-600" : "")}>
                        Finance {o.finance_reviewed_by ? "✓" : "—"}
                      </span>
                      {" · "}
                      <span className={cn(o.director_approved_by ? "text-emerald-600" : "")}>
                        Director {o.director_approved_by ? "✓" : "—"}
                      </span>
                    </td>
                    <td className="py-2 text-right">{fmt(o.total)}</td>
                    <td className="py-2">
                      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", STATUS_TONE[o.status])}>
                        {ORDER_STATUS_LABEL[o.status]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
