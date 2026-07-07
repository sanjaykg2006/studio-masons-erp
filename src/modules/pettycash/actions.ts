"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/core/supabase/server";
import { createAdminClient } from "@/core/supabase/admin";
import { authorize } from "@/core/rbac/can";
import { logAudit } from "@/modules/audit/log";

const DOCS_BUCKET = "pettycash-docs";
const MAX_DOC_BYTES = 25 * 1024 * 1024;

export type ActionResult = { ok: true } | { ok: false; error: string };
const ok: ActionResult = { ok: true };
const fail = (error: string): ActionResult => ({ ok: false, error });

const refresh = () => revalidatePath("/pettycash");

/** Any authenticated employee logs a spend. FormData carries the optional voucher. */
export async function createPettyCash(formData: FormData): Promise<ActionResult> {
  const amount = parseFloat(String(formData.get("amount") ?? "0"));
  if (!(amount > 0)) return fail("Enter an amount.");
  const projectId = String(formData.get("project_id") ?? "") || null;
  const categoryId = String(formData.get("category_id") ?? "") || null;
  const kind = String(formData.get("kind") ?? "reimbursement");
  const description = String(formData.get("description") ?? "");
  const spentOn = String(formData.get("spent_on") ?? "");

  let filePath: string | null = null;
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_DOC_BYTES) return fail("File is larger than 25 MB.");
    const safeName = file.name.replace(/[^\w.\- ]+/g, "_");
    const path = `voucher/${crypto.randomUUID()}-${safeName}`;
    const admin = createAdminClient();
    const { error } = await admin.storage
      .from(DOCS_BUCKET)
      .upload(path, file, { contentType: file.type || undefined, upsert: false });
    if (error) return fail(error.message);
    filePath = path;
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_pettycash", {
    p_project: projectId,
    p_category: categoryId,
    p_kind: kind,
    p_amount: amount,
    p_description: description,
    p_spent_on: spentOn || null,
    p_file: filePath,
  });
  if (error) {
    if (filePath) await createAdminClient().storage.from(DOCS_BUCKET).remove([filePath]);
    return fail(error.message);
  }
  await logAudit("pettycash.create", "Logged a petty-cash spend", { amount });
  refresh();
  return ok;
}

export async function billingApprovePettyCash(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("billing_approve_pettycash", { p_id: id });
  if (error) return fail(error.message);
  await logAudit("pettycash.billing", "Billing approved petty cash", { id });
  refresh();
  return ok;
}

export async function mdApprovePettyCash(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("md_approve_pettycash", { p_id: id });
  if (error) return fail(error.message);
  await logAudit("pettycash.md", "MD approved petty cash", { id });
  refresh();
  return ok;
}

export async function payPettyCash(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("pay_pettycash", { p_id: id });
  if (error) return fail(error.message);
  await logAudit("pettycash.paid", "Paid petty cash", { id });
  refresh();
  return ok;
}

export async function rejectPettyCash(id: string, reason: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_pettycash", { p_id: id, p_reason: reason });
  if (error) return fail(error.message);
  await logAudit("pettycash.reject", "Rejected petty cash", { id });
  refresh();
  return ok;
}

export async function deletePettyCash(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_pettycash", { p_id: id });
  if (error) return fail(error.message);
  refresh();
  return ok;
}

/** Short-lived signed link to a voucher document. */
export async function getVoucherUrl(
  entryId: string
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("pettycash_entries")
    .select("file_path")
    .eq("id", entryId)
    .maybeSingle();
  const path = (data as { file_path: string | null } | null)?.file_path;
  if (!path) return { ok: false, error: "No voucher uploaded." };
  const admin = createAdminClient();
  const { data: signed, error } = await admin.storage.from(DOCS_BUCKET).createSignedUrl(path, 60);
  if (error || !signed) return { ok: false, error: error?.message ?? "Could not create a link." };
  return { ok: true, url: signed.signedUrl };
}

// ── Categories (Billing) ─────────────────────────────────────────────────────

export async function savePettyCashCategory(id: string | null, name: string): Promise<ActionResult> {
  const denied = await authorize("pettycash.category", "manage");
  if (denied) return denied;
  const supabase = await createClient();
  const { error } = await supabase.rpc("upsert_pettycash_category", { p_id: id, p_name: name });
  if (error) return fail(error.message);
  refresh();
  return ok;
}

export async function setPettyCashCategoryActive(id: string, active: boolean): Promise<ActionResult> {
  const denied = await authorize("pettycash.category", "manage");
  if (denied) return denied;
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_pettycash_category_active", { p_id: id, p_active: active });
  if (error) return fail(error.message);
  refresh();
  return ok;
}
