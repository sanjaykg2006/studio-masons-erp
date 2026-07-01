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
  due_date: string | null;
  created_by: string;
  created_at: string;
  done_at: string | null;
};

export type TaskPerson = { user_id: string; full_name: string | null; email: string | null };
export type TaskSubteam = { id: string; key: string; label: string; sort: number };
export type TaskProjectRef = { id: string; name: string };
