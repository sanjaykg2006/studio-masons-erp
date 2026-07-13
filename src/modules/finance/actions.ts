"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/core/supabase/server";
import { createAdminClient } from "@/core/supabase/admin";
import { authorize, authorizeProject } from "@/core/rbac/can";
import { logAudit } from "@/modules/audit/log";
import type { TaxLine } from "@/modules/finance/types";
import {
  validateAccountsBooking,
  validateAdvanceRequest,
  validateBillingBranch,
  validateInvoiceEntry,
  validatePaymentRequest,
} from "@/modules/finance/validation";

const DOCS_BUCKET = "finance-docs";
const MAX_DOC_BYTES = 25 * 1024 * 1024; // 25 MB

export type ActionResult = { ok: true } | { ok: false; error: string };
const ok: ActionResult = { ok: true };
const fail = (error: string): ActionResult => ({ ok: false, error });

const refreshProject = (projectId: string) => revalidatePath(`/projects/${projectId}/finance`);
const refreshDashboard = () => revalidatePath("/finance");

async function uploadDoc(prefix: string, file: File): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  if (file.size > MAX_DOC_BYTES) return { ok: false, error: "File is larger than 25 MB." };
  const safeName = file.name.replace(/[^\w.\- ]+/g, "_");
  const path = `${prefix}/${crypto.randomUUID()}-${safeName}`;
  const admin = createAdminClient();
  const { error } = await admin.storage
    .from(DOCS_BUCKET)
    .upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, path };
}

// ── Invoices ─────────────────────────────────────────────────────────────────

/** PM enters a vendor invoice against a PO. FormData carries the file + JSON fields. */
export async function createInvoice(projectId: string, formData: FormData): Promise<ActionResult> {
  const denied = await authorizeProject(projectId, "finance.invoice", "create");
  if (denied) return denied;

  const orderId = String(formData.get("order_id") ?? "");
  const vendorInvoiceNo = String(formData.get("vendor_invoice_no") ?? "");
  const vendorInvoiceDate = String(formData.get("vendor_invoice_date") ?? "");
  const dueDate = String(formData.get("due_date") ?? "");
  const remarks = String(formData.get("remarks") ?? "");
  let lines: TaxLine[];
  try {
    lines = JSON.parse(String(formData.get("lines") ?? "[]")) as TaxLine[];
  } catch {
    return fail("Something went wrong reading the invoice lines.");
  }

  const invalid = validateInvoiceEntry({ orderId, vendorInvoiceNo, vendorInvoiceDate, lines });
  if (invalid) return fail(invalid);

  // Optional invoice document.
  let filePath: string | null = null;
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    const up = await uploadDoc(`invoice/${orderId}`, file);
    if (!up.ok) return fail(up.error);
    filePath = up.path;
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_invoice", {
    p_order: orderId,
    p_vendor_invoice_no: vendorInvoiceNo,
    p_vendor_invoice_date: vendorInvoiceDate || null,
    p_due_date: dueDate || null,
    p_lines: lines,
    p_file: filePath,
    p_remarks: remarks,
  });
  if (error) {
    if (filePath) await createAdminClient().storage.from(DOCS_BUCKET).remove([filePath]);
    return fail(error.message);
  }
  await logAudit("finance.invoice.create", "Entered a vendor invoice", { projectId, orderId });
  refreshProject(projectId);
  return ok;
}

export async function directorApproveInvoice(projectId: string, invoiceId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("director_approve_invoice", { p_invoice: invoiceId });
  if (error) return fail(error.message);
  await logAudit("finance.invoice.approve", "Director approved an invoice", { projectId, invoiceId });
  refreshProject(projectId);
  return ok;
}

export async function bypassInvoiceCap(projectId: string, invoiceId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("bypass_invoice_cap", { p_invoice: invoiceId });
  if (error) return fail(error.message);
  await logAudit("finance.invoice.bypass", "Overrode the PO cap on an invoice", { projectId, invoiceId });
  refreshProject(projectId);
  return ok;
}

/** Accounts books the invoice (money math). */
export async function accountsApproveInvoice(
  projectId: string,
  invoiceId: string,
  input: {
    lines: TaxLine[];
    otherCharges: number;
    tdsPct: number;
    deductAdvance: boolean;
    advanceAmount: number;
    holdRetention: boolean;
    remarks: string;
  }
): Promise<ActionResult> {
  const invalid = validateAccountsBooking(input);
  if (invalid) return fail(invalid);
  const supabase = await createClient();
  const { error } = await supabase.rpc("accounts_approve_invoice", {
    p_invoice: invoiceId,
    p_lines: input.lines,
    p_other_charges: input.otherCharges,
    p_tds_pct: input.tdsPct,
    p_deduct_advance: input.deductAdvance,
    p_advance_amount: input.advanceAmount,
    p_hold_retention: input.holdRetention,
    p_remarks: input.remarks,
  });
  if (error) return fail(error.message);
  await logAudit("finance.invoice.book", "Accounts booked an invoice", { projectId, invoiceId });
  refreshProject(projectId);
  refreshDashboard();
  return ok;
}

export async function rejectInvoice(projectId: string, invoiceId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_invoice", { p_invoice: invoiceId });
  if (error) return fail(error.message);
  await logAudit("finance.invoice.reject", "Rejected an invoice", { projectId, invoiceId });
  refreshProject(projectId);
  return ok;
}

export async function deleteInvoice(projectId: string, invoiceId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_invoice", { p_invoice: invoiceId });
  if (error) return fail(error.message);
  await logAudit("finance.invoice.delete", "Removed an invoice", { projectId, invoiceId });
  refreshProject(projectId);
  return ok;
}

/** A short-lived signed link to an invoice's uploaded document. */
export async function getInvoiceDocumentUrl(
  invoiceId: string
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: inv } = await supabase
    .from("finance_invoices")
    .select("file_path")
    .eq("id", invoiceId)
    .maybeSingle();
  const path = (inv as { file_path: string | null } | null)?.file_path;
  if (!path) return { ok: false, error: "No document uploaded." };
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(DOCS_BUCKET).createSignedUrl(path, 60);
  if (error || !data) return { ok: false, error: error?.message ?? "Could not create a link." };
  return { ok: true, url: data.signedUrl };
}

// ── Payment requests ─────────────────────────────────────────────────────────

export async function raisePaymentRequest(
  projectId: string,
  invoiceId: string,
  amount: number,
  priority: string,
  notes: string
): Promise<ActionResult> {
  const denied = await authorizeProject(projectId, "finance.payment", "create");
  if (denied) return denied;
  const invalid = validatePaymentRequest(amount);
  if (invalid) return fail(invalid);
  const supabase = await createClient();
  const { error } = await supabase.rpc("raise_payment_request", {
    p_invoice: invoiceId,
    p_amount: amount,
    p_priority: priority,
    p_notes: notes,
  });
  if (error) return fail(error.message);
  await logAudit("finance.payment.create", "Raised a payment request", { projectId, invoiceId });
  refreshProject(projectId);
  return ok;
}

export async function approvePaymentRequest(projectId: string, reqId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_payment_request", { p_req: reqId });
  if (error) return fail(error.message);
  await logAudit("finance.payment.approve", "Director approved a payment request", { projectId, reqId });
  refreshProject(projectId);
  return ok;
}

export async function markPaymentPaid(projectId: string, reqId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_payment_paid", { p_req: reqId });
  if (error) return fail(error.message);
  await logAudit("finance.payment.paid", "Marked a payment paid", { projectId, reqId });
  refreshProject(projectId);
  refreshDashboard();
  return ok;
}

export async function rejectPaymentRequest(projectId: string, reqId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_payment_request", { p_req: reqId });
  if (error) return fail(error.message);
  await logAudit("finance.payment.reject", "Rejected a payment request", { projectId, reqId });
  refreshProject(projectId);
  return ok;
}

// ── Retention ────────────────────────────────────────────────────────────────

export async function markRetentionPaid(projectId: string, retentionId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_retention_paid", { p_id: retentionId });
  if (error) return fail(error.message);
  await logAudit("finance.retention.paid", "Paid a retention", { projectId, retentionId });
  refreshProject(projectId);
  refreshDashboard();
  return ok;
}

export async function requestEarlyRetention(projectId: string, retentionId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_early_retention", { p_id: retentionId });
  if (error) return fail(error.message);
  await logAudit("finance.retention.request_early", "Requested early retention release", { projectId, retentionId });
  refreshProject(projectId);
  return ok;
}

export async function approveEarlyRetention(projectId: string, retentionId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_early_retention", { p_id: retentionId });
  if (error) return fail(error.message);
  await logAudit("finance.retention.approve_early", "Approved early retention release", { projectId, retentionId });
  refreshProject(projectId);
  return ok;
}

// ── PO advance + terms ───────────────────────────────────────────────────────

export async function setOrderTerms(
  projectId: string,
  orderId: string,
  input: { fixed: boolean; start: string | null; end: string | null; branchId: string | null }
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_order_terms", {
    p_order: orderId,
    p_fixed: input.fixed,
    p_start: input.start,
    p_end: input.end,
    p_branch: input.branchId,
  });
  if (error) return fail(error.message);
  await logAudit("finance.advance.terms", "Set PO terms", { projectId, orderId });
  refreshProject(projectId);
  return ok;
}

export async function requestPoAdvance(
  projectId: string,
  orderId: string,
  amount: number,
  tdsPct: number
): Promise<ActionResult> {
  const invalid = validateAdvanceRequest(amount, tdsPct);
  if (invalid) return fail(invalid);
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_po_advance", {
    p_order: orderId,
    p_amount: amount,
    p_tds_pct: tdsPct,
  });
  if (error) return fail(error.message);
  await logAudit("finance.advance.request", "Requested a PO advance", { projectId, orderId });
  refreshProject(projectId);
  return ok;
}

export async function approvePoAdvance(projectId: string, orderId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_po_advance", { p_order: orderId });
  if (error) return fail(error.message);
  await logAudit("finance.advance.approve", "Approved a PO advance", { projectId, orderId });
  refreshProject(projectId);
  return ok;
}

export async function payPoAdvance(projectId: string, orderId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("pay_po_advance", { p_order: orderId });
  if (error) return fail(error.message);
  await logAudit("finance.advance.pay", "Paid a PO advance", { projectId, orderId });
  refreshProject(projectId);
  refreshDashboard();
  return ok;
}

// ── Billing branches (settings) ──────────────────────────────────────────────

export async function saveBillingBranch(
  branchId: string | null,
  name: string,
  gstin: string,
  address: string
): Promise<ActionResult> {
  const denied = await authorize("finance.settings", "manage");
  if (denied) return denied;
  const invalid = validateBillingBranch(name);
  if (invalid) return fail(invalid);
  const supabase = await createClient();
  const { error } = await supabase.rpc("upsert_billing_branch", {
    p_id: branchId,
    p_name: name,
    p_gstin: gstin,
    p_address: address,
  });
  if (error) return fail(error.message);
  await logAudit("finance.settings.branch", "Saved a billing branch", { branchId });
  revalidatePath("/finance/settings");
  return ok;
}

export async function setBillingBranchActive(branchId: string, active: boolean): Promise<ActionResult> {
  const denied = await authorize("finance.settings", "manage");
  if (denied) return denied;
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_billing_branch_active", { p_id: branchId, p_active: active });
  if (error) return fail(error.message);
  revalidatePath("/finance/settings");
  return ok;
}
