"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/core/supabase/server";
import { authorize } from "@/core/rbac/can";
import { logAudit } from "@/modules/audit/log";
import { APPROVERS, type Approver } from "@/modules/access/approval-engine";
import { APPROVAL_FLOWS } from "@/modules/access/approval-flows";

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
  /** The one role that may give the stage; required unless a department lead does. */
  roleId: string | null;
  skipJobTitleIds: string[];
  minAmount: number | null;
  blockOwn: boolean;
};

/**
 * Add or edit an approval stage. A stage names ONE role and only that role may
 * give it, so the role is required. A project role may only be named on a flow
 * whose items belong to a project — off a project nobody could ever hold it.
 * Items already waiting at (or not yet past) the stage follow the edit — the
 * approval_stages_follow trigger (0104) updates their snapshot. The table's RLS
 * re-checks access:update.
 */
export async function saveApprovalStage(input: StageInput): Promise<ActionResult> {
  const denied = await authorize("access", "update");
  if (denied) return denied;

  const label = input.label.trim();
  if (!label) return fail("Give the stage a name.");
  if (!APPROVERS.includes(input.approver)) return fail("Choose who approves this stage.");
  if (input.minAmount != null && !(input.minAmount >= 0)) {
    return fail("The amount can't be negative.");
  }

  const supabase = await createClient();

  if (input.approver === "role") {
    if (!input.roleId) return fail("Choose the one role that approves this stage.");
    const [{ data: role }, { data: flow }] = await Promise.all([
      supabase.from("roles").select("label, department_id").eq("id", input.roleId).maybeSingle(),
      supabase.from("approval_flows").select("has_project").eq("id", input.flowId).maybeSingle(),
    ]);
    if (!role) return fail("That role no longer exists.");
    const r = role as { label: string; department_id: string | null };
    if (r.department_id) {
      if (!(flow as { has_project: boolean } | null)?.has_project) {
        return fail(
          `${r.label} is a project role, and these items don't belong to a project. Choose a job title instead.`
        );
      }
      // Only a department that runs the module may approve its items.
      const moduleId = APPROVAL_FLOWS.find((f) => f.engineId === input.flowId)?.module;
      const { data: allotted } = await supabase
        .from("department_modules")
        .select("module_id")
        .eq("department_id", r.department_id)
        .eq("module_id", moduleId ?? "")
        .maybeSingle();
      if (!allotted) {
        return fail(
          `That department isn't allotted this module, so its ${r.label} can't approve these items.`
        );
      }
    }
  }

  const row = {
    flow_id: input.flowId,
    label,
    approver: input.approver,
    role_id: input.approver === "role" ? input.roleId : null,
    skip_job_title_ids: input.skipJobTitleIds,
    min_amount: input.minAmount,
    block_own: input.blockOwn,
  };

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

/** Remove an approval stage. Items already past or waiting on it keep it. */
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
