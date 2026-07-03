import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import type { BudgetSpend } from "@/modules/procurement/types";

const fmt = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

/**
 * The project headline on top of the Budget page: released budget value against
 * value ordered on live purchase orders, with what's left (or the overrun).
 * A future Finance module can add "amount paid" as a third figure here.
 */
export function BudgetSpendSummary({ spend }: { spend: BudgetSpend }) {
  const { budgetTotal, expenditureTotal } = spend;
  const remaining = budgetTotal - expenditureTotal;
  const over = remaining < 0;
  // Clamp the bar; show the overrun tone in red when spend passes budget.
  const pct = budgetTotal > 0 ? Math.min(100, (expenditureTotal / budgetTotal) * 100) : 0;
  const pctLabel = budgetTotal > 0 ? Math.round((expenditureTotal / budgetTotal) * 100) : 0;

  return (
    <Card>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Project budget
            </div>
            <div className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">
              <span className="text-muted-foreground mr-0.5 text-xl font-medium">₹</span>
              {fmt(budgetTotal)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Total expenditure
            </div>
            <div className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">
              <span className="text-muted-foreground mr-0.5 text-xl font-medium">₹</span>
              {fmt(expenditureTotal)}
            </div>
            <div className="text-muted-foreground mt-0.5 text-xs">Ordered on live POs</div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="bg-muted h-2.5 w-full overflow-hidden rounded-full">
            <div
              className={cn("h-full rounded-full", over ? "bg-red-500" : "bg-primary")}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">{pctLabel}% of budget spent</span>
            <span
              className={cn(
                "font-medium tabular-nums",
                over ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"
              )}
            >
              {over ? `₹${fmt(-remaining)} over budget` : `₹${fmt(remaining)} remaining`}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
