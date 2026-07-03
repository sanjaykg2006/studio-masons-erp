"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/core/supabase/server";
import { authorize, authorizeProject } from "@/core/rbac/can";
import { logAudit } from "@/modules/audit/log";
import type { AssetInput, AssetStatus } from "@/modules/inventory/types";

export type ActionResult = { ok: true } | { ok: false; error: string };
const ok: ActionResult = { ok: true };
const fail = (error: string): ActionResult => ({ ok: false, error });

const clean = (s: string | undefined) => {
  const t = (s ?? "").trim();
  return t.length ? t : null;
};

// ── Project material (project-scoped: inventory.stock) ───────────────────────

/** Record a manual consumption against a budget line (capped at on-hand in the DB). */
export async function recordConsumption(
  projectId: string,
  budgetLineId: string,
  qty: number,
  consumedOn: string,
  note: string
): Promise<ActionResult> {
  if (!(qty > 0)) return fail("Enter a quantity greater than zero.");
  const denied = await authorizeProject(projectId, "inventory.stock", "create");
  if (denied) return denied;

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_consumption", {
    p_project: projectId,
    p_budget_line: budgetLineId,
    p_qty: qty,
    p_on: consumedOn || null,
    p_note: note,
  });
  if (error) return fail(error.message);
  await logAudit("inventory.consumption.record", "Recorded material consumption", {
    projectId,
    budgetLineId,
    qty,
  });
  revalidatePath(`/projects/${projectId}/inventory`);
  return ok;
}

/** Remove a consumption entry (fix a mis-entry). */
export async function deleteConsumption(
  projectId: string,
  entryId: string
): Promise<ActionResult> {
  const denied = await authorizeProject(projectId, "inventory.stock", "update");
  if (denied) return denied;

  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_consumption", { p_id: entryId });
  if (error) return fail(error.message);
  await logAudit("inventory.consumption.delete", "Removed a consumption entry", {
    projectId,
    entryId,
  });
  revalidatePath(`/projects/${projectId}/inventory`);
  return ok;
}

// ── Company assets (company-wide: inventory.asset) ───────────────────────────

const refreshAssets = () => revalidatePath("/inventory");

/** Add or edit an asset. Pass assetId null to create. */
export async function saveAsset(
  assetId: string | null,
  input: AssetInput,
  placement?: { projectId: string | null; custodianId: string | null }
): Promise<ActionResult> {
  if (!input.name.trim()) return fail("Enter an asset name.");
  const denied = await authorize("inventory.asset", assetId ? "update" : "create");
  if (denied) return denied;

  const supabase = await createClient();
  const { error } = await supabase.rpc("upsert_asset", {
    p_id: assetId,
    p_name: input.name.trim(),
    p_category: clean(input.category) ?? "other",
    p_tag: input.tag,
    p_notes: input.notes,
    p_project: placement?.projectId ?? null,
    p_custodian: placement?.custodianId ?? null,
  });
  if (error) return fail(error.message);
  await logAudit(assetId ? "inventory.asset.update" : "inventory.asset.create", `Saved asset "${input.name.trim()}"`, { assetId });
  refreshAssets();
  return ok;
}

/** Place an asset in a project + custodian directly (no transfer) — senior only. */
export async function assignAsset(
  assetId: string,
  projectId: string | null,
  custodianId: string | null
): Promise<ActionResult> {
  const denied = await authorize("inventory.asset", "delete");
  if (denied) return denied;

  const supabase = await createClient();
  const { error } = await supabase.rpc("assign_asset", {
    p_asset: assetId,
    p_project: projectId,
    p_custodian: custodianId,
  });
  if (error) return fail(error.message);
  await logAudit("inventory.asset.assign", "Assigned an asset", { assetId, projectId });
  refreshAssets();
  return ok;
}

/** Retire / reactivate an asset. */
export async function setAssetStatus(
  assetId: string,
  status: AssetStatus
): Promise<ActionResult> {
  const denied = await authorize("inventory.asset", "update");
  if (denied) return denied;

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_asset_status", { p_asset: assetId, p_status: status });
  if (error) return fail(error.message);
  await logAudit("inventory.asset.status", `Set an asset to "${status}"`, { assetId, status });
  refreshAssets();
  return ok;
}

/** Remove an asset from the registry. */
export async function deleteAsset(assetId: string): Promise<ActionResult> {
  const denied = await authorize("inventory.asset", "delete");
  if (denied) return denied;

  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_asset", { p_asset: assetId });
  if (error) return fail(error.message);
  await logAudit("inventory.asset.delete", "Removed an asset", { assetId });
  refreshAssets();
  return ok;
}

/** Request moving an asset to another project + a named new custodian. */
export async function requestAssetTransfer(
  assetId: string,
  toProjectId: string,
  toCustodianId: string,
  note: string
): Promise<ActionResult> {
  if (!toProjectId) return fail("Choose a project to transfer to.");
  if (!toCustodianId) return fail("Name the new custodian.");
  const denied = await authorize("inventory.asset", "update");
  if (denied) return denied;

  const supabase = await createClient();
  const { error } = await supabase.rpc("request_asset_transfer", {
    p_asset: assetId,
    p_to_project: toProjectId,
    p_to_custodian: toCustodianId,
    p_note: note,
  });
  if (error) return fail(error.message);
  await logAudit("inventory.asset.transfer_request", "Requested an asset transfer", {
    assetId,
    toProjectId,
  });
  refreshAssets();
  return ok;
}

/** The named new custodian accepts a transfer — the asset moves. */
export async function acceptAssetTransfer(transferId: string): Promise<ActionResult> {
  const denied = await authorize("inventory.asset", "read");
  if (denied) return denied;

  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_asset_transfer", { p_transfer: transferId });
  if (error) return fail(error.message);
  await logAudit("inventory.asset.transfer_accept", "Accepted an asset transfer", { transferId });
  refreshAssets();
  return ok;
}

/** The named new custodian declines a transfer. */
export async function rejectAssetTransfer(transferId: string): Promise<ActionResult> {
  const denied = await authorize("inventory.asset", "read");
  if (denied) return denied;

  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_asset_transfer", { p_transfer: transferId });
  if (error) return fail(error.message);
  await logAudit("inventory.asset.transfer_reject", "Declined an asset transfer", { transferId });
  refreshAssets();
  return ok;
}

/** The requester (or a manager) cancels a pending transfer. */
export async function cancelAssetTransfer(transferId: string): Promise<ActionResult> {
  const denied = await authorize("inventory.asset", "read");
  if (denied) return denied;

  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_asset_transfer", { p_transfer: transferId });
  if (error) return fail(error.message);
  await logAudit("inventory.asset.transfer_cancel", "Cancelled an asset transfer", { transferId });
  refreshAssets();
  return ok;
}
