"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/core/supabase/server";
import { logAudit } from "@/modules/audit/log";
import type { TaskStatus } from "@/modules/design/task-types";

export type ActionResult = { ok: true } | { ok: false; error: string };
const ok: ActionResult = { ok: true };
const fail = (error: string): ActionResult => ({ ok: false, error });

const clean = (s: string | null | undefined) => {
  const t = (s ?? "").trim();
  return t.length ? t : null;
};

export type NewTask = {
  departmentId: string;
  title: string;
  description?: string;
  subteamId?: string | null;
  projectId?: string | null;
  assigneeId?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
};

/** Create a task on a department's board. RLS enforces team membership + scope. */
export async function createTask(input: NewTask): Promise<ActionResult> {
  const title = input.title.trim();
  if (!title) return fail("Give the task a title.");

  const supabase = await createClient();
  const { error } = await supabase.from("tasks").insert({
    department_id: input.departmentId,
    title,
    description: clean(input.description),
    subteam_id: input.subteamId || null,
    project_id: input.projectId || null,
    assignee_id: input.assigneeId || null,
    start_date: input.startDate || null,
    due_date: input.dueDate || null,
  });
  if (error) return fail(error.message);
  await logAudit("task.create", `Created task "${title}"`, { departmentId: input.departmentId });
  revalidatePath("/design/tasks");
  return ok;
}

export type TaskEdit = {
  title?: string;
  description?: string | null;
  subteamId?: string | null;
  projectId?: string | null;
  assigneeId?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
};

/** Edit a task's fields. Only the fields provided are changed. */
export async function updateTask(taskId: string, fields: TaskEdit): Promise<ActionResult> {
  const patch: Record<string, unknown> = {};
  if (fields.title !== undefined) {
    const t = fields.title.trim();
    if (!t) return fail("Give the task a title.");
    patch.title = t;
  }
  if (fields.description !== undefined) patch.description = clean(fields.description);
  if (fields.subteamId !== undefined) patch.subteam_id = fields.subteamId || null;
  if (fields.projectId !== undefined) patch.project_id = fields.projectId || null;
  if (fields.assigneeId !== undefined) patch.assignee_id = fields.assigneeId || null;
  if (fields.startDate !== undefined) patch.start_date = fields.startDate || null;
  if (fields.dueDate !== undefined) patch.due_date = fields.dueDate || null;
  if (Object.keys(patch).length === 0) return ok;

  const supabase = await createClient();
  const { error } = await supabase.from("tasks").update(patch).eq("id", taskId);
  if (error) return fail(error.message);
  revalidatePath("/design/tasks");
  return ok;
}

/** Move a task between To do / In progress / Done. */
export async function setTaskStatus(taskId: string, status: TaskStatus): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("tasks")
    .update({ status, done_at: status === "done" ? new Date().toISOString() : null })
    .eq("id", taskId);
  if (error) return fail(error.message);
  revalidatePath("/design/tasks");
  return ok;
}

export async function deleteTask(taskId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("tasks").delete().eq("id", taskId);
  if (error) return fail(error.message);
  await logAudit("task.delete", "Deleted a task", { taskId });
  revalidatePath("/design/tasks");
  return ok;
}

/** Let a specific person see a task from outside its sub-team (or remove them). */
export async function setTaskInvite(
  taskId: string,
  userId: string,
  grant: boolean
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = grant
    ? await supabase.from("task_invites").upsert({ task_id: taskId, user_id: userId })
    : await supabase
        .from("task_invites")
        .delete()
        .eq("task_id", taskId)
        .eq("user_id", userId);
  if (error) return fail(error.message);
  revalidatePath("/design/tasks");
  return ok;
}
