/**
 * Pure petty-cash date maths and the summary shown on the Petty Cash and Finance
 * pages. No I/O, so it is unit-tested directly and safe in client components.
 */
import type { PettyCashEntry, PettyCashStatus } from "@/modules/pettycash/types";

/** Today in India as YYYY-MM-DD. The server runs on UTC; without this a claim
 * would turn overdue at 5:30 am instead of midnight. */
export function todayInIndia(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
}

/** Statuses still waiting on someone — the only ones that can be overdue. */
export const OPEN_STATUSES: readonly PettyCashStatus[] = [
  "pending_approval",
  "pending_accounts",
];

const isOpen = (s: PettyCashStatus) => OPEN_STATUSES.includes(s);

/** Whole days from date `a` to date `b` (both YYYY-MM-DD). */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

/** Days a still-open claim is past its pay-by date. 0 when it has no due date,
 * isn't due yet, or is already paid or rejected. */
export function daysOverdue(
  e: Pick<PettyCashEntry, "due_date" | "status">,
  today: string
): number {
  if (!e.due_date || !isOpen(e.status)) return 0;
  return Math.max(0, daysBetween(e.due_date, today));
}

type Total = { count: number; amount: number };
const add = (t: Total, amount: number) => {
  t.count += 1;
  t.amount += amount;
};

export type PettyCashSummary = {
  /** Waiting for approval or payment. */
  open: Total;
  overdue: Total & { oldestDays: number };
  /** Open, not overdue, due within the next `dueSoonDays` days (today included). */
  dueSoon: Total;
  /** Open claims by the step they are waiting on. */
  stages: (Total & { status: PettyCashStatus })[];
  /** Paid in the current calendar month; `late` = paid after their due date. */
  paidThisMonth: Total & { late: number };
  /** The most overdue open claims, worst first. */
  mostOverdue: (PettyCashEntry & { overdueDays: number })[];
};

export function summarizePettyCash(
  entries: PettyCashEntry[],
  today: string,
  { dueSoonDays = 7, topOverdue = 5 } = {}
): PettyCashSummary {
  const open: Total = { count: 0, amount: 0 };
  const overdue = { count: 0, amount: 0, oldestDays: 0 };
  const dueSoon: Total = { count: 0, amount: 0 };
  const stages = OPEN_STATUSES.map((status) => ({ status, count: 0, amount: 0 }));
  const paidThisMonth = { count: 0, amount: 0, late: 0 };
  const late: (PettyCashEntry & { overdueDays: number })[] = [];
  const month = today.slice(0, 7);

  for (const e of entries) {
    const amount = Number(e.amount) || 0;
    if (isOpen(e.status)) {
      add(open, amount);
      add(stages.find((s) => s.status === e.status)!, amount);
      const days = daysOverdue(e, today);
      if (days > 0) {
        add(overdue, amount);
        overdue.oldestDays = Math.max(overdue.oldestDays, days);
        late.push({ ...e, overdueDays: days });
      } else if (e.due_date && daysBetween(today, e.due_date) < dueSoonDays) {
        add(dueSoon, amount);
      }
    } else if (e.status === "paid" && e.paid_at) {
      const paidOn = todayInIndia(new Date(e.paid_at));
      if (paidOn.slice(0, 7) === month) {
        add(paidThisMonth, amount);
        if (e.due_date && paidOn > e.due_date) paidThisMonth.late += 1;
      }
    }
  }

  return {
    open,
    overdue,
    dueSoon,
    stages,
    paidThisMonth,
    mostOverdue: late.sort((a, b) => b.overdueDays - a.overdueDays).slice(0, topOverdue),
  };
}
