import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PettyCashSummary } from "@/modules/pettycash/analytics";
import { PETTYCASH_STATUS_LABEL, inr } from "@/modules/pettycash/types";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Petty-cash figures at a glance: open, overdue, due soon, paid this month, what
 * each approval step is holding, and the most overdue claims. Pure display —
 * the numbers come from summarizePettyCash over the entries the viewer can see.
 */
export function PettyCashSummaryPanel({
  summary,
  title,
  showWho,
  viewAllHref,
}: {
  summary: PettyCashSummary;
  title: string;
  /** Show who logged each overdue claim (for viewers who see everyone's). */
  showWho: boolean;
  /** Where "Open Petty Cash" links to; omitted on the Petty Cash page itself. */
  viewAllHref?: string;
}) {
  const { open, overdue, dueSoon, paidThisMonth, stages, mostOverdue } = summary;
  const tiles = [
    { label: "Open claims", value: inr(open.amount), hint: `${plural(open.count, "claim")} awaiting approval or payment` },
    {
      label: "Overdue",
      value: inr(overdue.amount),
      hint: overdue.count
        ? `${plural(overdue.count, "claim")} · oldest ${plural(overdue.oldestDays, "day")} late`
        : "nothing past its pay-by date",
      alert: overdue.count > 0,
    },
    { label: "Due in 7 days", value: inr(dueSoon.amount), hint: plural(dueSoon.count, "claim") },
    {
      label: "Paid this month",
      value: inr(paidThisMonth.amount),
      hint: `${plural(paidThisMonth.count, "claim")}${paidThisMonth.late ? ` · ${paidThisMonth.late} paid late` : ""}`,
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{title}</h2>
        {viewAllHref && (
          <Link href={viewAllHref} className="text-muted-foreground hover:text-foreground text-sm underline">
            Open Petty Cash
          </Link>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.label}>
            <CardContent className="pt-6">
              <div className="text-muted-foreground text-xs font-medium uppercase">{t.label}</div>
              <div className={t.alert ? "text-destructive mt-1 text-2xl font-semibold" : "mt-1 text-2xl font-semibold"}>
                {t.value}
              </div>
              <div className="text-muted-foreground text-xs">{t.hint}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="text-muted-foreground text-sm">
        {stages.map((s, i) => (
          <span key={s.status}>
            {i > 0 && " · "}
            {PETTYCASH_STATUS_LABEL[s.status]}: {plural(s.count, "claim")} ({inr(s.amount)})
          </span>
        ))}
      </p>

      {mostOverdue.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Most overdue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-left">
                    {showWho && <th className="py-2 font-medium">Who</th>}
                    <th className="py-2 font-medium">Category</th>
                    <th className="py-2 font-medium">Amount</th>
                    <th className="py-2 font-medium">Due</th>
                    <th className="py-2 font-medium">Overdue</th>
                    <th className="py-2 font-medium">Waiting on</th>
                  </tr>
                </thead>
                <tbody>
                  {mostOverdue.map((e) => (
                    <tr key={e.id} className="border-b last:border-0">
                      {showWho && <td className="py-2">{e.created_name ?? "—"}</td>}
                      <td className="py-2">{e.category_name ?? "—"}</td>
                      <td className="py-2">{inr(e.amount)}</td>
                      <td className="text-muted-foreground py-2">{e.due_date}</td>
                      <td className="text-destructive py-2 font-medium">{plural(e.overdueDays, "day")}</td>
                      <td className="text-muted-foreground py-2">{PETTYCASH_STATUS_LABEL[e.status]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
