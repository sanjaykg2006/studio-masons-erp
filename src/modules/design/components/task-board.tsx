"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  TASK_STATUS_LABEL,
  TASK_STATUS_ORDER,
  type TaskPerson,
  type TaskRow,
  type TaskStatus,
} from "@/modules/design/task-types";
import { deleteTask, setTaskStatus, updateTask } from "@/modules/design/task-actions";

const COLUMN_TONE: Record<TaskStatus, string> = {
  todo: "border-slate-400/40",
  in_progress: "border-amber-500/50",
  done: "border-emerald-500/50",
};

const selectClass =
  "border-input bg-background h-7 rounded-md border px-1.5 text-xs";

/** The three-column to-do board. Move a task, reassign it, or delete it. */
export function TaskBoard({
  tasks,
  people,
  onError,
}: {
  tasks: TaskRow[];
  people: TaskPerson[];
  onError: (msg: string | null) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) =>
    startTransition(async () => {
      onError(null);
      const res = await fn();
      if (!res.ok) onError(res.error);
      else router.refresh();
    });

  const dueTone = (due: string | null, status: TaskStatus) => {
    if (!due || status === "done") return "text-muted-foreground";
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const d = new Date(due + "T00:00:00");
    if (d < today) return "text-destructive font-medium";
    return "text-muted-foreground";
  };

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {TASK_STATUS_ORDER.map((status) => {
        const column = tasks.filter((t) => t.status === status);
        return (
          <div key={status} className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">{TASK_STATUS_LABEL[status]}</h3>
              <span className="text-muted-foreground text-xs">{column.length}</span>
            </div>
            {column.length === 0 && (
              <p className="text-muted-foreground rounded-md border border-dashed px-3 py-6 text-center text-xs">
                Nothing here.
              </p>
            )}
            {column.map((t) => (
              <div
                key={t.id}
                className={cn("space-y-2 rounded-md border-l-4 bg-card p-3 shadow-sm", COLUMN_TONE[status])}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium leading-snug">{t.title}</p>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      if (confirm(`Delete task "${t.title}"?`)) run(() => deleteTask(t.id));
                    }}
                    className="text-muted-foreground hover:text-destructive shrink-0"
                    aria-label="Delete task"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>

                {t.description && (
                  <p className="text-muted-foreground text-xs leading-snug">{t.description}</p>
                )}

                <div className="flex flex-wrap items-center gap-1.5">
                  {t.subteam_label && (
                    <span className="rounded-full bg-indigo-500/15 px-2 py-0.5 text-[10px] font-medium text-indigo-700 dark:text-indigo-400">
                      {t.subteam_label}
                    </span>
                  )}
                  {t.project_id && (
                    <Link
                      href={`/projects/${t.project_id}`}
                      className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium hover:underline"
                    >
                      {t.project_name ?? "Project"}
                    </Link>
                  )}
                  {t.due_date && (
                    <span className={cn("text-[10px]", dueTone(t.due_date, status))}>
                      Due {t.due_date}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <select
                    className={selectClass}
                    value={t.status}
                    disabled={pending}
                    onChange={(e) => run(() => setTaskStatus(t.id, e.target.value as TaskStatus))}
                    aria-label="Status"
                  >
                    {TASK_STATUS_ORDER.map((s) => (
                      <option key={s} value={s}>
                        {TASK_STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                  <select
                    className={selectClass}
                    value={t.assignee_id ?? ""}
                    disabled={pending}
                    onChange={(e) => run(() => updateTask(t.id, { assigneeId: e.target.value || null }))}
                    aria-label="Assignee"
                  >
                    <option value="">Unassigned</option>
                    {people.map((p) => (
                      <option key={p.user_id} value={p.user_id}>
                        {p.full_name ?? p.email}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
