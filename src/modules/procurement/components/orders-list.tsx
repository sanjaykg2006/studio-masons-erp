"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import {
  ORDER_STATUS_LABEL,
  type OrderStatus,
  type OrderSummary,
} from "@/modules/procurement/types";

const STATUS_TONE: Record<OrderStatus, string> = {
  draft: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  issued: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  closed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  amending: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
  cancelled: "bg-muted text-muted-foreground",
};

const fmt = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function OrdersList({
  projectId,
  projectName,
  orders,
}: {
  projectId: string;
  projectName: string;
  orders: OrderSummary[];
}) {
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
          One PO per vendor, created from an approved intent. Finance and the Director
          sign off, then the Procurement Manager releases it; goods are received
          against it.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          {orders.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No purchase orders yet. Approve an intent, then use{" "}
              <span className="font-medium">Enter vendor rates</span> to create them.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-left text-xs">
                    <th className="py-2 font-medium">PO</th>
                    <th className="py-2 font-medium">Vendor</th>
                    <th className="py-2 font-medium">Sign-off</th>
                    <th className="py-2 text-right font-medium">Budget</th>
                    <th className="py-2 text-right font-medium">Vendor</th>
                    <th className="py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => {
                    const over = o.total > o.budget_total;
                    return (
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
                        <td className="text-muted-foreground py-2 text-right">{fmt(o.budget_total)}</td>
                        <td className={cn("py-2 text-right", over && "text-red-600 dark:text-red-400")}>
                          {fmt(o.total)}
                        </td>
                        <td className="py-2">
                          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", STATUS_TONE[o.status])}>
                            {ORDER_STATUS_LABEL[o.status]}
                          </span>
                          {o.cancel_requested && (
                            <span className="ml-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-medium text-red-700 dark:text-red-400">
                              Cancel requested
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
