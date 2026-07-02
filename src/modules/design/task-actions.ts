"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/core/supabase/server";
import { createAdminClient } from "@/core/supabase/admin";
import { getUser } from "@/core/auth/get-user";
import { logAudit } from "@/modules/audit/log";
import type { TaskAttachment, TaskStatus } from "@/modules/design/task-types";

const DOCS_BUCKET = "task-docs";

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
  startTime?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
};

/** Create a task on a department's board. Only a department lead (or admin) may —
 * RLS is the real boundary; this gives a readable message before the round-trip. */
export async function createTask(input: NewTask): Promise<ActionResult> {
  const title = input.title.trim();
  if (!title) return fail("Give the task a title.");

  const supabase = await createClient();
  const [{ data: isLead }, { data: isAdmin }] = await Promise.all([
    supabase.rpc("is_department_lead", { p_department: input.departmentId }),
    supabase.rpc("has_permission", { p_resource: "access", p_action: "update" }),
  ]);
  if (!isLead && !isAdmin) {
    return fail("Only the department lead can create tasks.");
  }

  const { error } = await supabase.from("tasks").insert({
    department_id: input.departmentId,
    title,
    description: clean(input.description),
    subteam_id: input.subteamId || null,
    project_id: input.projectId || null,
    assignee_id: input.assigneeId || null,
    start_date: input.startDate || null,
    start_time: input.startTime || null,
    due_date: input.dueDate || null,
    due_time: input.dueTime || null,
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
  startTime?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
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
  if (fields.startTime !== undefined) patch.start_time = fields.startTime || null;
  if (fields.dueDate !== undefined) patch.due_date = fields.dueDate || null;
  if (fields.dueTime !== undefined) patch.due_time = fields.dueTime || null;
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

export type TaskInvitee = { user_id: string; full_name: string | null; email: string | null };

/** Load the people a task has been shared with (for the share panel). */
export async function loadTaskInvites(
  taskId: string
): Promise<{ ok: true; invitees: TaskInvitee[] } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_task_invites", { p_task: taskId });
  if (error) return { ok: false, error: error.message };
  return { ok: true, invitees: (data ?? []) as TaskInvitee[] };
}

// ── Attachments ───────────────────────────────────────────────────────────
// Bytes live in a private Storage bucket, written/read by the service role
// inside these gated actions; the task_attachments row (RLS-guarded) is the
// real security boundary — the same pattern the design files use.

const MAX_DOC_BYTES = 25 * 1024 * 1024; // 25 MB

/** Attach a document to a task. */
export async function uploadTaskAttachment(
  taskId: string,
  formData: FormData
): Promise<ActionResult> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("Choose a file.");
  if (file.size > MAX_DOC_BYTES) return fail("File is larger than 25 MB.");

  const id = crypto.randomUUID();
  const safeName = file.name.replace(/[^\w.\- ]+/g, "_");
  const path = `${taskId}/${id}-${safeName}`;

  const admin = createAdminClient();
  const { error: upErr } = await admin.storage
    .from(DOCS_BUCKET)
    .upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (upErr) return fail(upErr.message);

  const supabase = await createClient();
  const user = await getUser();
  const { error } = await supabase.from("task_attachments").insert({
    id,
    task_id: taskId,
    name: file.name,
    storage_path: path,
    mime_type: file.type || null,
    size_bytes: file.size,
    uploaded_by: user?.id ?? null,
  });
  if (error) {
    // RLS rejected (or other) — don't leave orphaned bytes behind.
    await admin.storage.from(DOCS_BUCKET).remove([path]);
    return fail(error.message);
  }
  await logAudit("task.attach", `Attached "${file.name}"`, { taskId });
  revalidatePath("/design/tasks");
  return ok;
}

/** The documents on a task (metadata only; links are minted on click). */
export async function loadTaskAttachments(
  taskId: string
): Promise<{ ok: true; docs: TaskAttachment[] } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_task_attachments", { p_task: taskId });
  if (error) return { ok: false, error: error.message };
  return { ok: true, docs: (data ?? []) as TaskAttachment[] };
}

/** A short-lived signed link to download one attachment the caller can see. */
export async function getTaskAttachmentUrl(
  attachmentId: string
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  // RLS ensures the caller can only read attachments on tasks they can see.
  const { data: doc } = await supabase
    .from("task_attachments")
    .select("storage_path, name")
    .eq("id", attachmentId)
    .maybeSingle();
  if (!doc) return { ok: false, error: "File not found." };

  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(DOCS_BUCKET)
    .createSignedUrl(doc.storage_path, 60, { download: doc.name });
  if (error || !data) return { ok: false, error: error?.message ?? "Could not create a link." };
  return { ok: true, url: data.signedUrl };
}

/** Remove an attachment (uploader or task manager). */
export async function deleteTaskAttachment(attachmentId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: doc } = await supabase
    .from("task_attachments")
    .select("storage_path, name")
    .eq("id", attachmentId)
    .maybeSingle();
  if (!doc) return fail("File not found.");

  const { error } = await supabase.from("task_attachments").delete().eq("id", attachmentId);
  if (error) return fail(error.message);
  createAdminClient().storage.from(DOCS_BUCKET).remove([doc.storage_path]);
  revalidatePath("/design/tasks");
  return ok;
}
