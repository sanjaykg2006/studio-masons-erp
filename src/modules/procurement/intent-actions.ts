"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/core/supabase/server";
import { logAudit } from "@/modules/audit/log";
import type { IntentLine, IntentLineDraft } from "@/modules/procurement/types";

export type ActionResult = { ok: true } | { ok: false; error: string };
const ok: ActionResult = { ok: true };
const fail = (error: string): ActionResult => ({ ok: false, error });

const refresh = (projectId: string) => revalidatePath(`/projects/${projectId}/intents`);

/** Raise a purchase intent against one or more released budget lines. */
export async function raiseIntent(
  projectId: string,
  neededBy: string,
  notes: string,
  lines: IntentLineDraft[]
): Promise<ActionResult> {
  const clean = lines.filter((l) => l.budget_line_id && l.qty > 0);
  if (clean.length === 0) return fail("Add at least one line with a quantity.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("raise_intent", {
    p_project: projectId,
    p_needed_by: neededBy || null,
    p_notes: notes,
    p_lines: clean.map((l) => ({
      budget_line_id: l.budget_line_id,
      qty: l.qty,
      location: l.location ?? "",
    })),
  });
  if (error) return fail(error.message);
  await logAudit("procurement.intent.raise", "Raised a purchase intent", { projectId });
  refresh(projectId);
  return ok;
}

export async function approveIntent(projectId: string, intentId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_intent", { p_intent: intentId });
  if (error) return fail(error.message);
  await logAudit("procurement.intent.approve", "Approved a purchase intent", { projectId, intentId });
  refresh(projectId);
  return ok;
}

export async function rejectIntent(projectId: string, intentId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_intent", { p_intent: intentId });
  if (error) return fail(error.message);
  await logAudit("procurement.intent.reject", "Rejected a purchase intent", { projectId, intentId });
  refresh(projectId);
  return ok;
}

export async function withdrawIntent(projectId: string, intentId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("withdraw_intent", { p_intent: intentId });
  if (error) return fail(error.message);
  await logAudit("procurement.intent.withdraw", "Withdrew a purchase intent", { projectId, intentId });
  refresh(projectId);
  return ok;
}

/** Load one intent's lines (called when a row is expanded). */
export async function loadIntentLines(
  intentId: string
): Promise<{ ok: true; lines: IntentLine[] } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_intent_lines", { p_intent: intentId });
  if (error) return { ok: false, error: error.message };
  return { ok: true, lines: (data ?? []) as IntentLine[] };
}
