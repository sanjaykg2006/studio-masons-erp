"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/core/supabase/server";
import { authorize } from "@/core/rbac/can";
import { moduleResources } from "@/core/modules/registry";
import { logAudit } from "@/modules/audit/log";
import type { Action } from "@/core/rbac/types";
import { APPROVERS, type Approver } from "@/modules/access/approval-engine";

export type ActionResult = { ok: true } | { ok: false; error: string };
const ok: ActionResult = { ok: true };
const fail = (error: string): ActionResult => ({ ok: false, error });

const refresh = () => revalidatePath("/access/approvals");

export type StageInput = {
  /** null = a new stage, added at the end of the flow. */
  id: string | null;
  flowId: string;
  label: string;
  approver: Approver;
  resource: string | null;
  action: Action | null;
  jobTitleId: string | null;
  skipJobTitleIds: string[];
  minAmount: number | null;
  blockOwn: boolean;
};

/**
 * Add or edit an approval stage. Items already in progress keep the stages
 * they started with; this changes new ones only. The table's RLS re-checks
 * access:update.
 */
export async function saveApprovalStage(input: StageInput): Promise<ActionResult> {
  const denied = await authorize("access", "update");
  if (denied) return denied;

  const label = input.label.trim();
  if (!label) return fail("Give the stage a name.");
  if (!APPROVERS.includes(input.approver)) return fail("Choose who approves this stage.");
  const needsTick = input.approver === "tick" || input.approver === "senior";
  if (needsTick) {
    const r = moduleResources().find((x) => x.id === input.resource);
    if (!r || !input.action || !r.actions.includes(input.action)) {
      return fail("Choose the tick that allows this stage.");
    }
  }
  if (input.approver === "job_title" && !input.jobTitleId) {
    return fail("Choose the job title that approves this stage.");
  }
  if (input.minAmount != null && !(input.minAmount >= 0)) {
    return fail("The amount can't be negative.");
  }

  const row = {
    flow_id: input.flowId,
    label,
    approver: input.approver,
    resource: needsTick ? input.resource : null,
    action: needsTick ? input.action : null,
    job_title_id: input.approver === "job_title" ? input.jobTitleId : null,
    skip_job_title_ids: input.skipJobTitleIds,
    min_amount: input.minAmount,
    block_own: input.blockOwn,
  };

  const supabase = await createClient();
  if (input.id) {
    const { error } = await supabase.from("approval_stages").update(row).eq("id", input.id);
    if (error) return fail(error.message);
  } else {
    const { data: last } = await supabase
      .from("approval_stages")
      .select("position")
      .eq("flow_id", input.flowId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    const position = ((last as { position: number } | null)?.position ?? 0) + 1;
    const { error } = await supabase.from("approval_stages").insert({ ...row, position });
    if (error) return fail(error.message);
  }
  await logAudit("approval.stage.save", `Saved approval stage "${label}"`, {
    flowId: input.flowId,
    stageId: input.id,
  });
  refresh();
  return ok;
}

/** Remove an approval stage. Items already past or waiting on it are unaffected. */
export async function deleteApprovalStage(stageId: string): Promise<ActionResult> {
  const denied = await authorize("access", "update");
  if (denied) return denied;
  const supabase = await createClient();
  const { error } = await supabase.from("approval_stages").delete().eq("id", stageId);
  if (error) return fail(error.message);
  await logAudit("approval.stage.delete", "Removed an approval stage", { stageId });
  refresh();
  return ok;
}

/** Move an approval stage one place earlier (up) or later in its flow. */
export async function moveApprovalStage(stageId: string, up: boolean): Promise<ActionResult> {
  const denied = await authorize("access", "update");
  if (denied) return denied;
  const supabase = await createClient();
  const { error } = await supabase.rpc("move_approval_stage", { p_stage: stageId, p_up: up });
  if (error) return fail(error.message);
  refresh();
  return ok;
}
