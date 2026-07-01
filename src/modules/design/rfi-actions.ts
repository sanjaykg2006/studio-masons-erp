"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/core/supabase/server";
import { logAudit } from "@/modules/audit/log";
import type { RfiMessage } from "@/modules/design/rfi-types";

export type ActionResult = { ok: true } | { ok: false; error: string };
const ok: ActionResult = { ok: true };
const fail = (error: string): ActionResult => ({ ok: false, error });

const refresh = (projectId: string) => revalidatePath(`/projects/${projectId}`);

/** Raise a question from the caller's department to another, on a project. */
export async function raiseRfi(
  projectId: string,
  toDepartmentId: string,
  subject: string,
  body: string
): Promise<ActionResult> {
  if (!subject.trim()) return fail("Enter a subject.");
  if (!toDepartmentId) return fail("Pick a department to ask.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("raise_rfi", {
    p_project: projectId,
    p_to_dept: toDepartmentId,
    p_subject: subject,
    p_body: body,
  });
  if (error) return fail(error.message);
  await logAudit("rfi.raise", `Raised an RFI: "${subject.trim()}"`, { projectId });
  refresh(projectId);
  return ok;
}

/** Post a reply on an RFI; flag it as the official answer if allowed. */
export async function postRfiMessage(
  projectId: string,
  rfiId: string,
  body: string,
  isAnswer: boolean
): Promise<ActionResult> {
  if (!body.trim()) return fail("Write a message.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("post_rfi_message", {
    p_rfi: rfiId,
    p_body: body,
    p_is_answer: isAnswer,
  });
  if (error) return fail(error.message);
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

/** Load one RFI's message thread (called when a row is expanded). */
export async function loadRfiThread(
  rfiId: string
): Promise<{ ok: true; messages: RfiMessage[] } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_rfi_thread", { p_rfi: rfiId });
  if (error) return { ok: false, error: error.message };
  return { ok: true, messages: (data ?? []) as RfiMessage[] };
}
