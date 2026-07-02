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
  created_by: string;
  created_at: string;
  done_at: string | null;
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
