"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";
import { AlertTriangle, ArrowLeft, CalendarDays, LayoutList, Plus } from "lucide-react";

import { useRealtimeRefresh } from "@/core/hooks/use-live-refresh";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  findTaskClashes,
  shortTime,
  type TaskPerson,
  type TaskProjectRef,
  type TaskRow,
  type TaskSubteam,
} from "@/modules/design/task-types";
import { createTask } from "@/modules/design/task-actions";
import { TaskBoard } from "@/modules/design/components/task-board";
import { TaskCalendar } from "@/modules/design/components/task-calendar";

const field = "border-input bg-background h-9 rounded-md border px-2 text-sm";
const emptyForm = {
  title: "",
  description: "",
  subteamId: "",
  projectId: "",
  assigneeId: "",
  startDate: "",
  startTime: "",
  dueDate: "",
  dueTime: "",
};

export function TasksView({
  departmentId,
  tasks,
  people,
  subteams,
  projects,
  canCreate,
  backHref,
  backLabel,
  subtitle,
}: {
  departmentId: string;
  tasks: TaskRow[];
  people: TaskPerson[];
  subteams: TaskSubteam[];
  projects: TaskProjectRef[];
  /** Only a department lead (or admin) may create tasks. */
  canCreate: boolean;
  /** Where the back arrow returns to — this department's home. Required so a new
   * caller can never silently fall back to some other department's page. */
  backHref: string;
  /** The back arrow's label — this department's name. */
  backLabel: string;
  /** The line under the "Tasks" heading, describing this department's board. */
  subtitle: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // A shared board: someone else adding, moving, pausing or finishing a task on
  // this department's board shows up here without anyone pressing reload.
  useRealtimeRefresh(`tasks:${departmentId}`, [
    { table: "tasks", filter: `department_id=eq.${departmentId}` },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"board" | "calendar">("board");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  // Tasks the pending new one would double-book the same person on. When set, we
  // hold off creating and show a warning the user can override.
  const [clashes, setClashes] = useState<TaskRow[] | null>(null);

  // Editing the form dismisses any stale clash warning; the next Add re-checks.
  const update = (patch: Partial<typeof emptyForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    if (clashes) setClashes(null);
  };

  const create = () => {
    startTransition(async () => {
      setError(null);
      const res = await createTask({ departmentId, ...form });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setForm(emptyForm);
      setClashes(null);
      setOpen(false);
      router.refresh();
    });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    const found = findTaskClashes(
      {
        assigneeId: form.assigneeId || null,
        start_date: form.startDate || null,
        start_time: form.startTime || null,
        due_date: form.dueDate || null,
        due_time: form.dueTime || null,
      },
      tasks
    );
    if (found.length > 0) {
      setClashes(found);
      return;
    }
    create();
  };

  const assigneeName =
    people.find((p) => p.user_id === form.assigneeId)?.full_name ??
    people.find((p) => p.user_id === form.assigneeId)?.email ??
    "this person";

  const whenLabel = (t: TaskRow) => {
    const date = t.start_date ?? t.due_date;
    if (!date) return "";
    const time = shortTime(t.start_time) ?? shortTime(t.due_time);
    const end = t.due_date && t.due_date !== t.start_date ? ` – ${t.due_date}` : "";
    return `${date}${time ? " " + time : ""}${end}`;
  };

  return (
    <div className="space-y-6">
      <Link
        href={backHref}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" /> {backLabel}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
          <p className="text-muted-foreground text-sm">{subtitle}</p>
        </div>
        <div className="flex gap-2">
          <div className="flex rounded-md border p-0.5">
            <button
              type="button"
              onClick={() => setView("board")}
              className={cn(
                "inline-flex items-center gap-1 rounded px-2 py-1 text-sm",
                view === "board" ? "bg-muted font-medium" : "text-muted-foreground"
              )}
            >
              <LayoutList className="size-4" /> Board
            </button>
            <button
              type="button"
              onClick={() => setView("calendar")}
              className={cn(
                "inline-flex items-center gap-1 rounded px-2 py-1 text-sm",
                view === "calendar" ? "bg-muted font-medium" : "text-muted-foreground"
              )}
            >
              <CalendarDays className="size-4" /> Calendar
            </button>
          </div>
          {canCreate && (
            <Button size="sm" onClick={() => setOpen((o) => !o)}>
              <Plus className="size-4" /> New task
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-md border px-4 py-2 text-sm">
          {error}
        </div>
      )}

      {open && (
        <Card>
          <CardContent className="pt-6">
            <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
              <Input
                placeholder="Task title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                aria-label="Task title"
                className="sm:col-span-2"
              />
              <textarea
                placeholder="Details (optional)"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                aria-label="Details"
                rows={2}
                className="border-input bg-background rounded-md border px-2 py-1 text-sm sm:col-span-2"
              />
              <select
                className={field}
                value={form.subteamId}
                onChange={(e) => setForm({ ...form, subteamId: e.target.value })}
                aria-label="Team"
              >
                <option value="">Shared (whole department)</option>
                {subteams.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label} only
                  </option>
                ))}
              </select>
              <select
                className={field}
                value={form.assigneeId}
                onChange={(e) => update({ assigneeId: e.target.value })}
                aria-label="Assign to"
              >
                <option value="">Unassigned</option>
                {people.map((p) => (
                  <option key={p.user_id} value={p.user_id}>
                    {p.full_name ?? p.email}
                  </option>
                ))}
              </select>
              <select
                className={field}
                value={form.projectId}
                onChange={(e) => setForm({ ...form, projectId: e.target.value })}
                aria-label="Linked project"
              >
                <option value="">No linked project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2 sm:col-span-2">
                <label className="text-muted-foreground flex flex-col gap-1 text-xs">
                  Start date
                  <input
                    type="date"
                    className={field}
                    value={form.startDate}
                    onChange={(e) => update({ startDate: e.target.value })}
                    aria-label="Start date"
                  />
                </label>
                <label className="text-muted-foreground flex flex-col gap-1 text-xs">
                  Start time
                  <input
                    type="time"
                    className={field}
                    value={form.startTime}
                    onChange={(e) => update({ startTime: e.target.value })}
                    aria-label="Start time"
                  />
                </label>
                <label className="text-muted-foreground flex flex-col gap-1 text-xs">
                  Due date
                  <input
                    type="date"
                    className={field}
                    value={form.dueDate}
                    onChange={(e) => update({ dueDate: e.target.value })}
                    aria-label="Due date"
                  />
                </label>
                <label className="text-muted-foreground flex flex-col gap-1 text-xs">
                  Due time
                  <input
                    type="time"
                    className={field}
                    value={form.dueTime}
                    onChange={(e) => update({ dueTime: e.target.value })}
                    aria-label="Due time"
                  />
                </label>
              </div>
              <p className="text-muted-foreground text-xs sm:col-span-2">
                You can attach documents to the task after adding it (open the task
                and use the paperclip).
              </p>
              {clashes && clashes.length > 0 && (
                <div className="border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-300 sm:col-span-2 space-y-2 rounded-md border px-4 py-3 text-sm">
                  <p className="flex items-center gap-1.5 font-medium">
                    <AlertTriangle className="size-4" />
                    This clashes with {assigneeName}&apos;s calendar
                  </p>
                  <ul className="ml-5 list-disc space-y-0.5 text-xs">
                    {clashes.map((c) => (
                      <li key={c.id}>
                        <span className="font-medium">{c.title}</span>
                        {whenLabel(c) ? ` — ${whenLabel(c)}` : ""}
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs">Add it anyway, or change the dates/person above.</p>
                </div>
              )}
              <div className="flex gap-2 sm:col-span-2">
                {clashes && clashes.length > 0 ? (
                  <>
                    <Button type="button" size="sm" variant="destructive" disabled={pending} onClick={create}>
                      Add anyway
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => setClashes(null)}>
                      Go back
                    </Button>
                  </>
                ) : (
                  <Button type="submit" size="sm" disabled={pending}>
                    Add task
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {view === "board" ? (
        <TaskBoard
          tasks={tasks}
          people={people}
          subteams={subteams}
          projects={projects}
          canManage={canCreate}
          onError={setError}
        />
      ) : (
        <TaskCalendar tasks={tasks} />
      )}
    </div>
  );
}
