"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { TaskRow } from "@/modules/design/task-types";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** A month grid showing each task on its due date. Read-only overview. */
export function TaskCalendar({ tasks }: { tasks: TaskRow[] }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0-based

  const byDay = useMemo(() => {
    const map = new Map<string, TaskRow[]>();
    for (const t of tasks) {
      if (!t.due_date) continue;
      const key = t.due_date.slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return map;
  }, [tasks]);

  // Cells for the grid, starting Monday.
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7; // Mon=0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const todayKey = iso(new Date());
  const undated = tasks.filter((t) => !t.due_date).length;

  const step = (delta: number) => {
    const m = month + delta;
    if (m < 0) { setMonth(11); setYear((y) => y - 1); }
    else if (m > 11) { setMonth(0); setYear((y) => y + 1); }
    else setMonth(m);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          {MONTHS[month]} {year}
        </h3>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" onClick={() => step(-1)} aria-label="Previous month">
            <ChevronLeft className="size-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={() => { setYear(now.getFullYear()); setMonth(now.getMonth()); }}>
            Today
          </Button>
          <Button size="sm" variant="outline" onClick={() => step(1)} aria-label="Next month">
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border bg-border text-xs">
        {WEEKDAYS.map((w) => (
          <div key={w} className="bg-muted text-muted-foreground px-2 py-1 text-center font-medium">
            {w}
          </div>
        ))}
        {cells.map((d, i) => {
          const key = d ? iso(d) : `blank-${i}`;
          const dayTasks = d ? byDay.get(iso(d)) ?? [] : [];
          return (
            <div
              key={key}
              className={cn(
                "min-h-20 bg-background p-1 align-top",
                d && iso(d) === todayKey && "ring-primary ring-1 ring-inset"
              )}
            >
              {d && <div className="text-muted-foreground mb-1 text-right text-[10px]">{d.getDate()}</div>}
              <div className="space-y-1">
                {dayTasks.map((t) => (
                  <div
                    key={t.id}
                    title={t.title}
                    className={cn(
                      "truncate rounded px-1 py-0.5 text-[10px]",
                      t.status === "done"
                        ? "bg-emerald-500/15 text-emerald-700 line-through dark:text-emerald-400"
                        : "bg-indigo-500/15 text-indigo-700 dark:text-indigo-400"
                    )}
                  >
                    {t.title}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {undated > 0 && (
        <p className="text-muted-foreground text-xs">
          {undated} task{undated === 1 ? "" : "s"} with no due date aren&apos;t shown on the calendar.
        </p>
      )}
    </div>
  );
}
