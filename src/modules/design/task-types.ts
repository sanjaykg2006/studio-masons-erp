// Pure task types + constants — safe to import from client components (no
// server-only dependencies). The data-loading functions live in task-data.ts.

export type TaskStatus = "todo" | "in_progress" | "done";

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};

export const TASK_STATUS_ORDER: TaskStatus[] = ["todo", "in_progress", "done"];

export type TaskRow = {
  id: string;
  subteam_id: string | null;
  subteam_label: string | null;
  project_id: string | null;
  project_name: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  assignee_id: string | null;
  assignee_name: string | null;
  start_date: string | null;
  start_time: string | null;
  due_date: string | null;
  due_time: string | null;
  /** When on hold; null = running. Only the assigner can pause/resume. */
  paused_at: string | null;
  created_by: string;
  created_at: string;
  done_at: string | null;
};

/** The date/time fields that place a task on the calendar. */
export type TaskSchedule = {
  start_date: string | null;
  start_time: string | null;
  due_date: string | null;
  due_time: string | null;
};

export type TaskPerson = { user_id: string; full_name: string | null; email: string | null };
export type TaskSubteam = { id: string; key: string; label: string; sort: number };
export type TaskProjectRef = { id: string; name: string };

export type TaskAttachment = {
  id: string;
  name: string;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  created_at: string;
};

/** "09:00" from a "09:00:00" / null time value. */
export const shortTime = (t: string | null | undefined): string | null =>
  t ? t.slice(0, 5) : null;

// ── Scheduling clashes ──────────────────────────────────────────────────────
// A newly-created task is flagged when it overlaps an existing task for the SAME
// person on the calendar. A missing time means the whole day (00:00 … 23:59), so
// two dated-but-untimed tasks on the same day count as a clash ("day wise"), and
// tasks with times clash only when their hours actually overlap ("time wise").

const dateTimeMs = (date: string, time: string | null, endOfDay: boolean): number => {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  let hh = 0;
  let mm = 0;
  if (time) {
    const [h, min] = time.slice(0, 5).split(":").map(Number);
    hh = h ?? 0;
    mm = min ?? 0;
  } else if (endOfDay) {
    hh = 23;
    mm = 59;
  }
  return new Date(y, m - 1, d, hh, mm).getTime();
};

/** A task's scheduled window as [start, end] in epoch-ms, or null if it carries
 *  no dates (and so never appears on the calendar). */
export function taskInterval(t: TaskSchedule): { start: number; end: number } | null {
  const startDate = t.start_date ?? t.due_date;
  const endDate = t.due_date ?? t.start_date;
  if (!startDate || !endDate) return null;
  const start = dateTimeMs(startDate, t.start_time, false);
  const end = dateTimeMs(endDate, t.due_time, true);
  return end < start ? { start: end, end: start } : { start, end };
}

/** Existing tasks that clash with a candidate: the same assignee, an overlapping
 *  window, and not already done. Touching endpoints (one ends as the next starts)
 *  don't count as a clash. */
export function findTaskClashes(
  candidate: TaskSchedule & { assigneeId: string | null },
  tasks: TaskRow[]
): TaskRow[] {
  if (!candidate.assigneeId) return [];
  const ci = taskInterval(candidate);
  if (!ci) return [];
  return tasks.filter((t) => {
    if (t.status === "done" || t.assignee_id !== candidate.assigneeId) return false;
    const ti = taskInterval(t);
    return ti ? ci.start < ti.end && ti.start < ci.end : false;
  });
}

/** Human file size, e.g. "1.2 MB". */
export function humanSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let u = 0;
  while (n >= 1024 && u < units.length - 1) {
    n /= 1024;
    u++;
  }
  return `${n >= 10 || u === 0 ? Math.round(n) : n.toFixed(1)} ${units[u]}`;
}
