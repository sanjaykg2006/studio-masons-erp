"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { shortTime, type TaskRow } from "@/modules/design/task-types";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Row layout (px): the day-number strip, then stacked task bars.
const HEADER_H = 18;
const BAR_H = 17;
const BAR_GAP = 3;
const BOTTOM_PAD = 4;

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseISO = (s: string) => {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const dayNo = (d: Date) => Math.round(d.getTime() / 86_400_000);

/** A task's date span [start, end] (inclusive), or null if it has no dates. */
function span(t: TaskRow): { start: Date; end: Date } | null {
  const s = t.start_date ? parseISO(t.start_date) : t.due_date ? parseISO(t.due_date) : null;
  const e = t.due_date ? parseISO(t.due_date) : t.start_date ? parseISO(t.start_date) : null;
  if (!s || !e) return null;
  return e < s ? { start: e, end: s } : { start: s, end: e };
}

type Seg = {
  task: TaskRow;
  colStart: number;
  colEnd: number;
  lane: number;
  startsHere: boolean;
  endsHere: boolean;
};

/**
 * A month view where each task is a bar stretching from its start date to its
 * due date, labelled with the person it's assigned to. Bars stack (each gets its
 * own lane) so several running at once don't overlap.
 */
export function TaskCalendar({ tasks }: { tasks: TaskRow[] }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0-based

  const dated = useMemo(() => tasks.map((t) => ({ t, s: span(t) })).filter((x) => x.s), [tasks]);
  const undated = tasks.length - dated.length;

  // The visible grid: whole weeks (Mon–Sun) covering the month.
  const weeks = useMemo(() => {
    const first = new Date(year, month, 1);
    const startOffset = (first.getDay() + 6) % 7; // Mon = 0
    const gridStart = addDays(first, -startOffset);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const weekCount = Math.ceil((startOffset + daysInMonth) / 7);

    return Array.from({ length: weekCount }, (_, w) => {
      const weekStart = addDays(gridStart, w * 7);
      const weekEnd = addDays(weekStart, 6);
      const ws = dayNo(weekStart);
      const we = dayNo(weekEnd);

      // Segments of any task overlapping this week.
      const segs: Seg[] = [];
      for (const { t, s } of dated) {
        if (!s) continue;
        const ts = dayNo(s.start);
        const te = dayNo(s.end);
        if (te < ws || ts > we) continue;
        segs.push({
          task: t,
          colStart: Math.max(ts, ws) - ws,
          colEnd: Math.min(te, we) - ws,
          lane: 0,
          startsHere: ts >= ws,
          endsHere: te <= we,
        });
      }
      // Greedy lane packing: earliest start first, then longest.
      segs.sort((a, b) => a.colStart - b.colStart || b.colEnd - b.colStart - (a.colEnd - a.colStart));
      const laneEnds: number[] = [];
      for (const seg of segs) {
        let lane = 0;
        while (laneEnds[lane] !== undefined && laneEnds[lane] >= seg.colStart) lane++;
        seg.lane = lane;
        laneEnds[lane] = seg.colEnd;
      }

      return { weekStart, laneCount: laneEnds.length, segs };
    });
  }, [dated, year, month]);

  const todayKey = iso(new Date());

  const step = (delta: number) => {
    const m = month + delta;
    if (m < 0) { setMonth(11); setYear((y) => y - 1); }
    else if (m > 11) { setMonth(0); setYear((y) => y + 1); }
    else setMonth(m);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{MONTHS[month]} {year}</h3>
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

      <div className="overflow-hidden rounded-md border bg-border text-xs">
        {/* Weekday header */}
        <div className="grid grid-cols-7 gap-px">
          {WEEKDAYS.map((w) => (
            <div key={w} className="bg-muted text-muted-foreground px-2 py-1 text-center font-medium">
              {w}
            </div>
          ))}
        </div>

        {/* One relative row per week: day cells behind, task bars in front. */}
        {weeks.map(({ weekStart, laneCount, segs }, wi) => {
          const rowHeight = HEADER_H + Math.max(1, laneCount) * (BAR_H + BAR_GAP) + BOTTOM_PAD;
          return (
            <div key={wi} className="relative" style={{ height: rowHeight }}>
              <div className="absolute inset-0 grid grid-cols-7 gap-px">
                {Array.from({ length: 7 }, (_, i) => {
                  const d = addDays(weekStart, i);
                  const inMonth = d.getMonth() === month;
                  return (
                    <div
                      key={i}
                      className={cn(
                        "bg-background px-1 pt-0.5",
                        !inMonth && "bg-muted/30",
                        iso(d) === todayKey && "ring-primary ring-1 ring-inset"
                      )}
                    >
                      <div className={cn("text-right text-[10px]", inMonth ? "text-muted-foreground" : "text-muted-foreground/40")}>
                        {d.getDate()}
                      </div>
                    </div>
                  );
                })}
              </div>

              {segs.map((seg) => {
                const t = seg.task;
                const time = shortTime(t.start_time);
                const done = t.status === "done";
                const paused = Boolean(t.paused_at);
                return (
                  <div
                    key={t.id}
                    title={`${t.title}${t.assignee_name ? " — " + t.assignee_name : ""}${paused ? " (paused)" : ""}`}
                    className={cn(
                      "absolute overflow-hidden whitespace-nowrap px-1.5 text-[10px] leading-[17px]",
                      seg.startsHere ? "rounded-l" : "",
                      seg.endsHere ? "rounded-r" : "",
                      done
                        ? "bg-emerald-500/20 text-emerald-800 line-through dark:text-emerald-300"
                        : paused
                          ? "bg-amber-500/20 text-amber-800 dark:text-amber-300"
                          : "bg-indigo-500/25 text-indigo-900 dark:text-indigo-200"
                    )}
                    style={{
                      left: `calc(${(seg.colStart / 7) * 100}% + 2px)`,
                      width: `calc(${((seg.colEnd - seg.colStart + 1) / 7) * 100}% - 4px)`,
                      top: HEADER_H + seg.lane * (BAR_H + BAR_GAP),
                      height: BAR_H,
                    }}
                  >
                    {seg.startsHere && paused ? <span>⏸ </span> : null}
                    {seg.startsHere && time ? <span className="font-medium">{time} </span> : null}
                    <span className="font-medium">{t.title}</span>
                    {t.assignee_name ? <span className="opacity-80"> · {t.assignee_name}</span> : null}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {undated > 0 && (
        <p className="text-muted-foreground text-xs">
          {undated} task{undated === 1 ? "" : "s"} with no dates {undated === 1 ? "isn't" : "aren't"} shown on the calendar.
        </p>
      )}
    </div>
  );
}
