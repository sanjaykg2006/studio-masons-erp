import "server-only";

import { createClient } from "@/core/supabase/server";
import type {
  BillingBranch,
  FinanceOrder,
  FinanceSummary,
  InvoiceAgeing,
  InvoiceDetail,
  InvoiceLine,
  InvoiceSummary,
  PaymentSummary,
  RetentionRow,
  VendorOutstanding,
} from "@/modules/finance/types";

// ── Per-project reads ────────────────────────────────────────────────────────

export async function listProjectInvoices(projectId: string): Promise<InvoiceSummary[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("list_project_invoices", { p_project: projectId });
  return (data ?? []) as InvoiceSummary[];
}

export async function getInvoice(invoiceId: string): Promise<InvoiceDetail | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_invoice", { p_invoice: invoiceId });
  const rows = (data ?? []) as InvoiceDetail[];
  return rows[0] ?? null;
}

export async function getInvoiceLines(invoiceId: string): Promise<InvoiceLine[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_invoice_lines", { p_invoice: invoiceId });
  return (data ?? []) as InvoiceLine[];
}

export async function listProjectPayments(projectId: string): Promise<PaymentSummary[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("list_project_payments", { p_project: projectId });
  return (data ?? []) as PaymentSummary[];
}

export async function listProjectRetention(projectId: string): Promise<RetentionRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("list_project_retention", { p_project: projectId });
  return (data ?? []) as RetentionRow[];
}

export async function listProjectFinanceOrders(projectId: string): Promise<FinanceOrder[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("list_project_finance_orders", { p_project: projectId });
  return (data ?? []) as FinanceOrder[];
}

// ── Billing branches (company-wide) ──────────────────────────────────────────

export async function listBillingBranches(activeOnly = false): Promise<BillingBranch[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("list_billing_branches", { p_active_only: activeOnly });
  return (data ?? []) as BillingBranch[];
}

// ── Company-wide reports (Finance dashboard) ─────────────────────────────────

export async function getFinanceSummary(): Promise<FinanceSummary> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("finance_summary");
  const rows = (data ?? []) as FinanceSummary[];
  return rows[0] ?? { total_owed: 0, paid_this_month: 0, advances_unpaid: 0, retention_held: 0 };
}

export async function getVendorOutstanding(): Promise<VendorOutstanding[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("vendor_outstanding_statement");
  return (data ?? []) as VendorOutstanding[];
}

export async function getInvoiceAgeing(): Promise<InvoiceAgeing[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("finance_invoice_ageing");
  return (data ?? []) as InvoiceAgeing[];
}
