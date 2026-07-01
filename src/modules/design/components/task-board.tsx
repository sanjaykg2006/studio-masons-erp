"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Pencil, Share2, Trash2, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  TASK_STATUS_LABEL,
  TASK_STATUS_ORDER,
  type TaskPerson,
  type TaskProjectRef,
  type TaskRow,
  type TaskStatus,
  type TaskSubteam,
} from "@/modules/design/task-types";
import {
  deleteTask,
  loadTaskInvites,
  setTaskInvite,
  setTaskStatus,
  updateTask,
  type TaskInvitee,
} from "@/modules/design/task-actions";

const COLUMN_TONE: Record<TaskStatus, string> = {
  todo: "border-slate-400/40",
  in_progress: "border-amber-500/50",
  done: "border-emerald-500/50",
};

const sel = "border-input bg-background h-7 rounded-md border px-1.5 text-xs";
const field = "border-input bg-background h-8 w-full rounded-md border px-2 text-sm";

type SharedProps = {
  people: TaskPerson[];
  subteams: TaskSubteam[];
  projects: TaskProjectRef[];
  onError: (msg: string | null) => void;
};

/** The three-column to-do board. */
export function TaskBoard({
  tasks,
  ...shared
}: { tasks: TaskRow[] } & SharedProps) {
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
              <TaskCard key={t.id} task={t} {...shared} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function TaskCard({ task: t, people, subteams, projects, onError }: { task: TaskRow } & SharedProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [showShare, setShowShare] = useState(false);
  const [invitees, setInvitees] = useState<TaskInvitee[] | null>(null);
  const [addPerson, setAddPerson] = useState("");
  const [form, setForm] = useState({
    title: t.title,
    description: t.description ?? "",
    subteamId: t.subteam_id ?? "",
    projectId: t.project_id ?? "",
    assigneeId: t.assignee_id ?? "",
    startDate: t.start_date ?? "",
    dueDate: t.due_date ?? "",
  });

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, after?: () => void) =>
    startTransition(async () => {
      onError(null);
      const res = await fn();
      if (!res.ok) onError(res.error);
      else {
        after?.();
        router.refresh();
      }
    });

  const openShare = async () => {
    const next = !showShare;
    setShowShare(next);
    if (next && invitees === null) {
      const res = await loadTaskInvites(t.id);
      if (res.ok) setInvitees(res.invitees);
      else onError(res.error);
    }
  };

  const addInvite = (userId: string) => {
    if (!userId) return;
    run(
      () => setTaskInvite(t.id, userId, true),
      () => {
        const p = people.find((x) => x.user_id === userId);
        if (p) setInvitees((cur) => [...(cur ?? []), { user_id: p.user_id, full_name: p.full_name, email: p.email }]);
        setAddPerson("");
      }
    );
  };

  const removeInvite = (userId: string) =>
    run(
      () => setTaskInvite(t.id, userId, false),
      () => setInvitees((cur) => (cur ?? []).filter((x) => x.user_id !== userId))
    );

  const dueTone = (() => {
    if (!t.due_date || t.status === "done") return "text-muted-foreground";
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return new Date(t.due_date + "T00:00:00") < today ? "text-destructive font-medium" : "text-muted-foreground";
  })();

  if (mode === "edit") {
    return (
      <div className={cn("space-y-2 rounded-md border-l-4 bg-card p-3 shadow-sm", COLUMN_TONE[t.status])}>
        <Input
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          className="h-8"
          aria-label="Title"
        />
        <textarea
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          rows={2}
          placeholder="Details"
          className="border-input bg-background w-full rounded-md border px-2 py-1 text-sm"
          aria-label="Details"
        />
        <select className={field} value={form.subteamId} onChange={(e) => setForm({ ...form, subteamId: e.target.value })} aria-label="Team">
          <option value="">Shared (whole department)</option>
          {subteams.map((s) => (
            <option key={s.id} value={s.id}>{s.label} only</option>
          ))}
        </select>
        <select className={field} value={form.assigneeId} onChange={(e) => setForm({ ...form, assigneeId: e.target.value })} aria-label="Assignee">
          <option value="">Unassigned</option>
          {people.map((p) => (
            <option key={p.user_id} value={p.user_id}>{p.full_name ?? p.email}</option>
          ))}
        </select>
        <select className={field} value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })} aria-label="Linked project">
          <option value="">No linked project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <div className="grid grid-cols-2 gap-2">
          <input type="date" className={field} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} aria-label="Start date" />
          <input type="date" className={field} value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} aria-label="Due date" />
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              run(
                () =>
                  updateTask(t.id, {
                    title: form.title,
                    description: form.description,
                    subteamId: form.subteamId || null,
                    projectId: form.projectId || null,
                    assigneeId: form.assigneeId || null,
                    startDate: form.startDate || null,
                    dueDate: form.dueDate || null,
                  }),
                () => setMode("view")
              )
            }
          >
            Save
          </Button>
          <Button size="sm" variant="outline" onClick={() => setMode("view")}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-2 rounded-md border-l-4 bg-card p-3 shadow-sm", COLUMN_TONE[t.status])}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-snug">{t.title}</p>
        <div className="flex shrink-0 gap-1.5">
          <button type="button" disabled={pending} onClick={() => setMode("edit")} className="text-muted-foreground hover:text-foreground" aria-label="Edit task">
            <Pencil className="size-3.5" />
          </button>
          <button type="button" disabled={pending} onClick={openShare} className={cn("hover:text-foreground", showShare ? "text-foreground" : "text-muted-foreground")} aria-label="Share task">
            <Share2 className="size-3.5" />
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (confirm(`Delete task "${t.title}"?`)) run(() => deleteTask(t.id));
            }}
            className="text-muted-foreground hover:text-destructive"
            aria-label="Delete task"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      {t.description && <p className="text-muted-foreground text-xs leading-snug">{t.description}</p>}

      <div className="flex flex-wrap items-center gap-1.5">
        {t.subteam_label && (
          <span className="rounded-full bg-indigo-500/15 px-2 py-0.5 text-[10px] font-medium text-indigo-700 dark:text-indigo-400">
            {t.subteam_label}
          </span>
        )}
        {t.project_id && (
          <Link href={`/projects/${t.project_id}`} className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium hover:underline">
            {t.project_name ?? "Project"}
          </Link>
        )}
        {t.due_date && <span className={cn("text-[10px]", dueTone)}>Due {t.due_date}</span>}
      </div>

      {showShare && (
        <div className="space-y-1.5 rounded-md border bg-background/60 p-2">
          <p className="text-muted-foreground text-[10px] font-medium">
            Shared with (can see this task even if it&apos;s another team&apos;s):
          </p>
          {invitees === null ? (
            <p className="text-muted-foreground text-[10px]">Loading…</p>
          ) : invitees.length === 0 ? (
            <p className="text-muted-foreground text-[10px]">No one extra yet.</p>
          ) : (
            <ul className="space-y-1">
              {invitees.map((p) => (
                <li key={p.user_id} className="flex items-center justify-between text-xs">
                  <span>{p.full_name ?? p.email}</span>
                  <button type="button" disabled={pending} onClick={() => removeInvite(p.user_id)} className="text-muted-foreground hover:text-destructive" aria-label="Remove">
                    <X className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <select className={sel} value={addPerson} disabled={pending} onChange={(e) => addInvite(e.target.value)} aria-label="Share with">
            <option value="">+ share with…</option>
            {people
              .filter((p) => !(invitees ?? []).some((x) => x.user_id === p.user_id))
              .map((p) => (
                <option key={p.user_id} value={p.user_id}>{p.full_name ?? p.email}</option>
              ))}
          </select>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        <select className={sel} value={t.status} disabled={pending} onChange={(e) => run(() => setTaskStatus(t.id, e.target.value as TaskStatus))} aria-label="Status">
          {TASK_STATUS_ORDER.map((s) => (
            <option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>
          ))}
        </select>
        <select className={sel} value={t.assignee_id ?? ""} disabled={pending} onChange={(e) => run(() => updateTask(t.id, { assigneeId: e.target.value || null }))} aria-label="Assignee">
          <option value="">Unassigned</option>
          {people.map((p) => (
            <option key={p.user_id} value={p.user_id}>{p.full_name ?? p.email}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
