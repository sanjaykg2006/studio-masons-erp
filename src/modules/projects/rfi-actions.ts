"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/core/supabase/server";
import { createAdminClient } from "@/core/supabase/admin";
import { getUser } from "@/core/auth/get-user";
import { logAudit } from "@/modules/audit/log";
import type { RfiAttachment, RfiMessage } from "@/modules/projects/rfi-types";

export type ActionResult = { ok: true } | { ok: false; error: string };
const ok: ActionResult = { ok: true };
const fail = (error: string): ActionResult => ({ ok: false, error });

const refresh = (projectId: string) => revalidatePath(`/projects/${projectId}`);

const DOCS_BUCKET = "rfi-docs";
const MAX_DOC_BYTES = 25 * 1024 * 1024; // 25 MB

/** Attach any files carried on `formData` (field name "files") to a message.
 * Bytes go to a private Storage bucket via the service role; the RLS-guarded
 * rfi_attachments row is the real security boundary. Returns an error string on
 * the first failure, or null when everything (or nothing) was uploaded. */
async function attachFiles(messageId: string, formData: FormData): Promise<string | null> {
  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return null;

  const admin = createAdminClient();
  const supabase = await createClient();
  const user = await getUser();

  for (const file of files) {
    if (file.size > MAX_DOC_BYTES) return `"${file.name}" is larger than 25 MB.`;
    const id = crypto.randomUUID();
    const safeName = file.name.replace(/[^\w.\- ]+/g, "_");
    const path = `${messageId}/${id}-${safeName}`;

    const { error: upErr } = await admin.storage
      .from(DOCS_BUCKET)
      .upload(path, file, { contentType: file.type || undefined, upsert: false });
    if (upErr) return upErr.message;

    const { error } = await supabase.from("rfi_attachments").insert({
      id,
      message_id: messageId,
      name: file.name,
      storage_path: path,
      mime_type: file.type || null,
      size_bytes: file.size,
      uploaded_by: user?.id ?? null,
    });
    if (error) {
      // RLS rejected (or other) — don't leave orphaned bytes behind.
      await admin.storage.from(DOCS_BUCKET).remove([path]);
      return error.message;
    }
  }
  return null;
}

/** Raise a question from the caller's department to another, on a project.
 * `toRoleId` optionally aims it at a specific rung of the target department's
 * ladder (empty = start at the most junior role). Any files on `formData`
 * attach to the question's opening message. */
export async function raiseRfi(
  projectId: string,
  toDepartmentId: string,
  subject: string,
  body: string,
  toRoleId?: string,
  formData?: FormData
): Promise<ActionResult> {
  if (!subject.trim()) return fail("Enter a subject.");
  if (!toDepartmentId) return fail("Pick a department to ask.");
  const hasFiles = !!formData && formData.getAll("files").some((f) => f instanceof File && f.size > 0);
  if (hasFiles && !body.trim()) return fail("Write your question so the file has a message to attach to.");

  const supabase = await createClient();
  const { data: rfiId, error } = await supabase.rpc("raise_rfi", {
    p_project: projectId,
    p_to_dept: toDepartmentId,
    p_subject: subject,
    p_body: body,
    p_to_role: toRoleId || null,
  });
  if (error) return fail(error.message);

  if (hasFiles && rfiId) {
    // The opening message is the first (and, on a new RFI, only) one.
    const { data } = await supabase.rpc("get_rfi_thread", { p_rfi: rfiId });
    const firstMessage = ((data ?? []) as RfiMessage[])[0];
    if (firstMessage) {
      const err = await attachFiles(firstMessage.id, formData!);
      if (err) return fail(err);
    }
  }
  await logAudit("rfi.raise", `Raised an RFI: "${subject.trim()}"`, { projectId });
  refresh(projectId);
  return ok;
}

/** Post a reply on an RFI; flag it as the official answer if allowed. Any files
 * on `formData` attach to the message just posted. */
export async function postRfiMessage(
  projectId: string,
  rfiId: string,
  body: string,
  isAnswer: boolean,
  formData?: FormData
): Promise<ActionResult> {
  if (!body.trim()) return fail("Write a message.");
  const supabase = await createClient();
  const { data: messageId, error } = await supabase.rpc("post_rfi_message", {
    p_rfi: rfiId,
    p_body: body,
    p_is_answer: isAnswer,
  });
  if (error) return fail(error.message);

  if (formData && messageId) {
    const err = await attachFiles(messageId, formData);
    if (err) return fail(err);
  }
  refresh(projectId);
  return ok;
}

/** Escalate an RFI one rung up the target department's seniority ladder. */
export async function escalateRfi(projectId: string, rfiId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("escalate_rfi", { p_rfi: rfiId });
  if (error) return fail(error.message);
  await logAudit("rfi.escalate", "Escalated an RFI", { projectId, rfiId });
  refresh(projectId);
  return ok;
}

export async function closeRfi(projectId: string, rfiId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("close_rfi", { p_rfi: rfiId });
  if (error) return fail(error.message);
  await logAudit("rfi.close", "Closed an RFI", { projectId, rfiId });
  refresh(projectId);
  return ok;
}

/** Load one RFI's message thread plus the files attached across it (called when
 * a row is expanded). */
export async function loadRfiThread(
  rfiId: string
): Promise<
  | { ok: true; messages: RfiMessage[]; attachments: RfiAttachment[] }
  | { ok: false; error: string }
> {
  const supabase = await createClient();
  const [threadRes, filesRes] = await Promise.all([
    supabase.rpc("get_rfi_thread", { p_rfi: rfiId }),
    supabase.rpc("list_rfi_attachments", { p_rfi: rfiId }),
  ]);
  if (threadRes.error) return { ok: false, error: threadRes.error.message };
  if (filesRes.error) return { ok: false, error: filesRes.error.message };
  return {
    ok: true,
    messages: (threadRes.data ?? []) as RfiMessage[],
    attachments: (filesRes.data ?? []) as RfiAttachment[],
  };
}

/** A short-lived signed link to download one attachment the caller can see. */
export async function getRfiAttachmentUrl(
  attachmentId: string
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  // RLS ensures the caller can only read files on questions they can see.
  const { data: doc } = await supabase
    .from("rfi_attachments")
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

/** Remove an attachment (uploader, target department's lead, or an admin). */
export async function deleteRfiAttachment(
  projectId: string,
  attachmentId: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: doc } = await supabase
    .from("rfi_attachments")
    .select("storage_path")
    .eq("id", attachmentId)
    .maybeSingle();
  if (!doc) return fail("File not found.");

  const { error } = await supabase.from("rfi_attachments").delete().eq("id", attachmentId);
  if (error) return fail(error.message);
  createAdminClient().storage.from(DOCS_BUCKET).remove([doc.storage_path]);
  refresh(projectId);
  return ok;
}
