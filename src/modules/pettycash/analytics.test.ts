import { describe, expect, it } from "vitest";

import { daysOverdue, summarizePettyCash, todayInIndia } from "@/modules/pettycash/analytics";
import type { PettyCashEntry } from "@/modules/pettycash/types";

const entry = (over: Partial<PettyCashEntry>): PettyCashEntry => ({
  id: Math.random().toString(36),
  created_by: "u1",
  created_name: "Someone",
  project_id: null,
  project_name: null,
  category_name: "Travel",
  kind: "reimbursement",
  amount: 100,
  description: null,
  spent_on: "2026-09-01",
  file_path: null,
  status: "pending_billing",
  reject_reason: null,
  created_at: "2026-09-01T05:00:00Z",
  mine: true,
  can_billing: false,
  can_md: false,
  can_pay: false,
  can_reject: false,
  due_date: null,
  paid_at: null,
  ...over,
});

describe("todayInIndia", () => {
  it("rolls over at Indian midnight, not UTC midnight", () => {
    // 20:00 UTC on the 10th is 01:30 on the 11th in India.
    expect(todayInIndia(new Date("2026-09-10T20:00:00Z"))).toBe("2026-09-11");
    expect(todayInIndia(new Date("2026-09-10T18:00:00Z"))).toBe("2026-09-10");
  });
});

describe("daysOverdue", () => {
  const today = "2026-09-11";

  it("counts whole days past the due date for an open claim", () => {
    expect(daysOverdue(entry({ due_date: "2026-09-08" }), today)).toBe(3);
    expect(daysOverdue(entry({ due_date: "2026-09-08", status: "pending_accounts" }), today)).toBe(3);
  });

  it("is 0 on or before the due date", () => {
    expect(daysOverdue(entry({ due_date: today }), today)).toBe(0);
    expect(daysOverdue(entry({ due_date: "2026-09-20" }), today)).toBe(0);
  });

  it("is 0 without a due date, or once paid or rejected", () => {
    expect(daysOverdue(entry({ due_date: null }), today)).toBe(0);
    expect(daysOverdue(entry({ due_date: "2026-09-01", status: "paid" }), today)).toBe(0);
    expect(daysOverdue(entry({ due_date: "2026-09-01", status: "rejected" }), today)).toBe(0);
  });
});

describe("summarizePettyCash", () => {
  const today = "2026-09-11";
  const s = summarizePettyCash(
    [
      entry({ amount: 500, due_date: "2026-09-01" }), // 10 days overdue
      entry({ amount: 200, due_date: "2026-09-09", status: "pending_md" }), // 2 overdue
      entry({ amount: 300, due_date: "2026-09-15", status: "pending_accounts" }), // due soon
      entry({ amount: 50, due_date: "2026-10-30" }), // open, not soon
      entry({ amount: 70 }), // open, no due date
      entry({ amount: 400, status: "paid", due_date: "2026-09-05", paid_at: "2026-09-07T06:00:00Z" }), // paid late
      entry({ amount: 90, status: "paid", paid_at: "2026-08-30T06:00:00Z" }), // last month
      entry({ amount: 999, status: "rejected", due_date: "2026-09-01" }),
    ],
    today
  );

  it("totals open, overdue and due-soon claims", () => {
    expect(s.open).toEqual({ count: 5, amount: 1120 });
    expect(s.overdue).toEqual({ count: 2, amount: 700, oldestDays: 10 });
    expect(s.dueSoon).toEqual({ count: 1, amount: 300 });
  });

  it("splits open claims by the step they wait on", () => {
    expect(s.stages.map((x) => [x.status, x.count, x.amount])).toEqual([
      ["pending_billing", 3, 620],
      ["pending_md", 1, 200],
      ["pending_accounts", 1, 300],
    ]);
  });

  it("counts this month's payments and the late ones", () => {
    expect(s.paidThisMonth).toEqual({ count: 1, amount: 400, late: 1 });
  });

  it("lists the most overdue first", () => {
    expect(s.mostOverdue.map((e) => e.overdueDays)).toEqual([10, 2]);
  });
});
