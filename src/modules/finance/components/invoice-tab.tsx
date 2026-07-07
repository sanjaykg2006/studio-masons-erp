"use client";

import { useRouter } from "next/navigation";
import { Fragment, type FormEvent, useMemo, useState, useTransition } from "react";
import { Check, FileText, Plus, ShieldAlert, Trash2, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  INVOICE_STATUS_LABEL,
  MAX_TAX_LINES,
  computeApproval,
  emptyTaxLine,
  inr,
  type FinanceOrder,
  type InvoiceStatus,
  type InvoiceSummary,
  type TaxLine,
  type TaxLineForm,
} from "@/modules/finance/types";
import type { ApproveSeed } from "@/modules/finance/components/finance-view";
import {
  accountsApproveInvoice,
  bypassInvoiceCap,
  createInvoice,
  deleteInvoice,
  directorApproveInvoice,
  getInvoiceDocumentUrl,
  raisePaymentRequest,
  rejectInvoice,
} from "@/modules/finance/actions";

type Result = { ok: true } | { ok: false; error: string };
const field = "border-input bg-background h-9 rounded-md border px-2 text-sm";

const STATUS_TONE: Record<InvoiceStatus, string> = {
  pending_director: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  pending_accounts: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  approved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  rejected: "bg-destructive/10 text-destructive",
};

const toLines = (forms: TaxLineForm[]): TaxLine[] =>
  forms
    .map((l) => ({
      base: parseFloat(l.base || "0"),
      sgst: parseFloat(l.sgst || "0"),
      cgst: parseFloat(l.cgst || "0"),
      igst: parseFloat(l.igst || "0"),
    }))
    .filter((l) => l.base > 0);

export function InvoiceTab({
  projectId,
  invoices,
  orders,
  approveSeed,
  canCreate,
}: {
  projectId: string;
  invoices: InvoiceSummary[];
  orders: FinanceOrder[];
  approveSeed: ApproveSeed;
  canCreate: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [booking, setBooking] = useState<string | null>(null);
  const [raising, setRaising] = useState<string | null>(null);

  const run = (fn: () => Promise<Result>, after?: () => void) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error);
      else {
        after?.();
        router.refresh();
      }
    });

  // Only POs whose acceptance letter is on file can be invoiced.
  const invoiceableOrders = orders.filter((o) => o.acceptance_on_file);

  const openDoc = (invoiceId: string) =>
    startTransition(async () => {
      const res = await getInvoiceDocumentUrl(invoiceId);
      if (res.ok) window.open(res.url, "_blank", "noopener,noreferrer");
      else setError(res.error);
    });

  const remove = (inv: InvoiceSummary) => {
    if (!confirm(`Delete invoice ${inv.invoice_no}?`)) return;
    run(() => deleteInvoice(projectId, inv.id));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">
          A vendor&apos;s bill against a purchase order. Director approves, then Accounts books it.
        </p>
        {canCreate && (
          <Button size="sm" onClick={() => setAdding((a) => !a)}>
            <Plus className="size-4" /> New invoice
          </Button>
        )}
      </div>

      {error && (
        <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-md border px-4 py-2 text-sm">
          {error}
        </div>
      )}

      {adding && canCreate && (
        <CreateInvoiceForm
          projectId={projectId}
          orders={invoiceableOrders}
          hasBlockedOrders={orders.length > invoiceableOrders.length}
          pending={pending}
          onDone={() => setAdding(false)}
          onError={setError}
          onSubmitted={() => {
            setAdding(false);
            router.refresh();
          }}
        />
      )}

      <Card>
        <CardContent className="pt-6">
          {invoices.length === 0 ? (
            <p className="text-muted-foreground text-sm">No invoices yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-left">
                    <th className="py-2 font-medium">Invoice</th>
                    <th className="py-2 font-medium">Vendor / PO</th>
                    <th className="py-2 font-medium">Total</th>
                    <th className="py-2 font-medium">Payable</th>
                    <th className="py-2 font-medium">Status</th>
                    <th className="py-2 font-medium">Days due</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <Fragment key={inv.id}>
                      <tr className="border-b last:border-0">
                        <td className="py-2">
                          <div className="font-medium">{inv.invoice_no}</div>
                          <div className="text-muted-foreground text-xs">
                            #{inv.vendor_invoice_no} · {inv.vendor_invoice_date}
                          </div>
                        </td>
                        <td className="text-muted-foreground py-2">
                          {inv.vendor_name}
                          {inv.po_number && <span className="text-xs"> · {inv.po_number}</span>}
                        </td>
                        <td className="py-2">{inr(inv.amount_total)}</td>
                        <td className="py-2">
                          {inv.status === "approved" ? (
                            <span>
                              {inr(inv.amount_payable)}
                              {inv.remaining < inv.amount_payable && (
                                <span className="text-muted-foreground text-xs">
                                  {" "}
                                  · {inr(inv.remaining)} left
                                </span>
                              )}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-2">
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[10px] font-medium",
                              STATUS_TONE[inv.status]
                            )}
                          >
                            {INVOICE_STATUS_LABEL[inv.status]}
                          </span>
                          {inv.over_cap && !inv.cap_bypassed && (
                            <span className="text-destructive ml-1 inline-flex items-center gap-0.5 text-[10px]">
                              <ShieldAlert className="size-3" /> over PO
                            </span>
                          )}
                        </td>
                        <td className="text-muted-foreground py-2">
                          {inv.days_due == null ? "—" : `${inv.days_due}d`}
                        </td>
                        <td className="py-2">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => openDoc(inv.id)}
                              className="text-muted-foreground hover:text-foreground"
                              title="Open the invoice document"
                              aria-label="Open document"
                            >
                              <FileText className="size-4" />
                            </button>

                            {/* Over-cap override (Director/MD) */}
                            {inv.over_cap && !inv.cap_bypassed && inv.can_manage && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={pending}
                                onClick={() => run(() => bypassInvoiceCap(projectId, inv.id))}
                              >
                                Override cap
                              </Button>
                            )}

                            {/* Director approval */}
                            {inv.status === "pending_director" && inv.can_approve && (
                              <>
                                <Button
                                  size="sm"
                                  disabled={pending}
                                  onClick={() => run(() => directorApproveInvoice(projectId, inv.id))}
                                >
                                  <Check className="size-4" /> Approve
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={pending}
                                  onClick={() => run(() => rejectInvoice(projectId, inv.id))}
                                >
                                  Reject
                                </Button>
                              </>
                            )}

                            {/* Accounts booking */}
                            {inv.status === "pending_accounts" && inv.can_book && (
                              <Button
                                size="sm"
                                disabled={pending}
                                onClick={() => setBooking((id) => (id === inv.id ? null : inv.id))}
                              >
                                Book
                              </Button>
                            )}

                            {/* Raise a payment request */}
                            {inv.status === "approved" && inv.remaining > 0 && inv.can_raise_payment && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={pending}
                                onClick={() => setRaising((id) => (id === inv.id ? null : inv.id))}
                              >
                                Request payment
                              </Button>
                            )}

                            {inv.can_delete && inv.status !== "approved" && (
                              <button
                                type="button"
                                disabled={pending}
                                onClick={() => remove(inv)}
                                className="text-muted-foreground hover:text-destructive"
                                title="Delete"
                                aria-label="Delete invoice"
                              >
                                <Trash2 className="size-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {booking === inv.id && approveSeed[inv.id] && (
                        <tr>
                          <td colSpan={7} className="pb-3">
                            <BookInvoiceForm
                              projectId={projectId}
                              invoiceId={inv.id}
                              seed={approveSeed[inv.id]}
                              pending={pending}
                              onCancel={() => setBooking(null)}
                              onError={setError}
                              onDone={() => {
                                setBooking(null);
                                router.refresh();
                              }}
                            />
                          </td>
                        </tr>
                      )}

                      {raising === inv.id && (
                        <tr>
                          <td colSpan={7} className="pb-3">
                            <RaisePaymentForm
                              projectId={projectId}
                              invoiceId={inv.id}
                              remaining={inv.remaining}
                              pending={pending}
                              onCancel={() => setRaising(null)}
                              onError={setError}
                              onDone={() => {
                                setRaising(null);
                                router.refresh();
                              }}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** PM enters a new vendor invoice against a PO. */
function CreateInvoiceForm({
  projectId,
  orders,
  hasBlockedOrders,
  pending,
  onDone,
  onError,
  onSubmitted,
}: {
  projectId: string;
  orders: FinanceOrder[];
  hasBlockedOrders: boolean;
  pending: boolean;
  onDone: () => void;
  onError: (e: string) => void;
  onSubmitted: () => void;
}) {
  const [orderId, setOrderId] = useState("");
  const [vendorInvoiceNo, setVendorInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [remarks, setRemarks] = useState("");
  const [lines, setLines] = useState<TaxLineForm[]>([emptyTaxLine()]);
  const [file, setFile] = useState<File | null>(null);
  const [submitting, startSubmit] = useTransition();

  const setLine = (i: number, patch: Partial<TaxLineForm>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const previewTotal = useMemo(() => {
    const tl = toLines(lines);
    const c = computeApproval({
      lines: tl,
      otherCharges: 0,
      tdsPct: 0,
      deductAdvance: false,
      advanceAmount: 0,
      holdRetention: false,
      advanceRemaining: 0,
    });
    return c.total;
  }, [lines]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!orderId) return onError("Choose the purchase order this invoice is against.");
    if (!vendorInvoiceNo.trim()) return onError("Enter the vendor's invoice number.");
    if (!invoiceDate) return onError("Enter the vendor's invoice date.");
    if (toLines(lines).length === 0) return onError("Enter a base value on at least one line.");

    const fd = new FormData();
    fd.set("order_id", orderId);
    fd.set("vendor_invoice_no", vendorInvoiceNo);
    fd.set("vendor_invoice_date", invoiceDate);
    fd.set("due_date", dueDate);
    fd.set("remarks", remarks);
    fd.set("lines", JSON.stringify(toLines(lines)));
    if (file) fd.set("file", file);

    startSubmit(async () => {
      const res = await createInvoice(projectId, fd);
      if (!res.ok) onError(res.error);
      else onSubmitted();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">New vendor invoice</CardTitle>
        <CardDescription>
          Pick the PO, enter the vendor&apos;s bill details, and add the GST base lines.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {orders.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No purchase orders are ready to invoice.
            {hasBlockedOrders && " Upload the vendor's acceptance letter on the PO first."}
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <select
                className={cn(field, "sm:flex-1")}
                value={orderId}
                onChange={(e) => setOrderId(e.target.value)}
                aria-label="Purchase order"
              >
                <option value="">Choose purchase order…</option>
                {orders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.po_number ?? "PO"} · {o.vendor_name} · {inr(o.po_total)}
                  </option>
                ))}
              </select>
              <Input
                placeholder="Vendor invoice no."
                value={vendorInvoiceNo}
                onChange={(e) => setVendorInvoiceNo(e.target.value)}
                className="sm:w-44"
                aria-label="Vendor invoice number"
              />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <label className="text-muted-foreground flex items-center gap-2 text-sm">
                Invoice date
                <input
                  type="date"
                  className={field}
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                  aria-label="Invoice date"
                />
              </label>
              <label className="text-muted-foreground flex items-center gap-2 text-sm">
                Due date
                <input
                  type="date"
                  className={field}
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  aria-label="Payment due date"
                />
              </label>
            </div>

            {/* GST base lines */}
            <div className="space-y-2">
              <div className="text-muted-foreground grid grid-cols-[1fr_repeat(3,4rem)_1.5rem] gap-2 text-xs font-medium">
                <span>Base value</span>
                <span>SGST%</span>
                <span>CGST%</span>
                <span>IGST%</span>
                <span />
              </div>
              {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-[1fr_repeat(3,4rem)_1.5rem] items-center gap-2">
                  <Input
                    inputMode="decimal"
                    placeholder="0"
                    value={l.base}
                    onChange={(e) => setLine(i, { base: e.target.value })}
                    aria-label={`Base value line ${i + 1}`}
                  />
                  <input className={field} inputMode="decimal" value={l.sgst} onChange={(e) => setLine(i, { sgst: e.target.value })} aria-label="SGST %" />
                  <input className={field} inputMode="decimal" value={l.cgst} onChange={(e) => setLine(i, { cgst: e.target.value })} aria-label="CGST %" />
                  <input className={field} inputMode="decimal" value={l.igst} onChange={(e) => setLine(i, { igst: e.target.value })} aria-label="IGST %" />
                  {lines.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Remove line"
                    >
                      <X className="size-4" />
                    </button>
                  ) : (
                    <span />
                  )}
                </div>
              ))}
              {lines.length < MAX_TAX_LINES && (
                <button
                  type="button"
                  onClick={() => setLines((ls) => [...ls, emptyTaxLine()])}
                  className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
                >
                  <Plus className="size-3" /> Add line
                </button>
              )}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                placeholder="Remarks (optional)"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                className="sm:flex-1"
                aria-label="Remarks"
              />
              <input
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="text-muted-foreground text-xs"
                aria-label="Invoice document"
              />
            </div>

            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" disabled={pending || submitting}>
                Submit invoice · {inr(previewTotal)}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={onDone}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

/** Accounts books the invoice: the money math. */
function BookInvoiceForm({
  projectId,
  invoiceId,
  seed,
  pending,
  onCancel,
  onError,
  onDone,
}: {
  projectId: string;
  invoiceId: string;
  seed: ApproveSeed[string];
  pending: boolean;
  onCancel: () => void;
  onError: (e: string) => void;
  onDone: () => void;
}) {
  const { detail, lines: seedLines } = seed;
  const [lines, setLines] = useState<TaxLineForm[]>(
    seedLines.length
      ? seedLines.map((l) => ({
          base: String(l.base),
          sgst: String(l.sgst),
          cgst: String(l.cgst),
          igst: String(l.igst),
        }))
      : [emptyTaxLine()]
  );
  const [otherCharges, setOtherCharges] = useState(String(detail.other_charges || 0));
  const [tdsPct, setTdsPct] = useState(String(detail.tds_pct ?? 2));
  const [deductAdvance, setDeductAdvance] = useState(false);
  const [advanceAmount, setAdvanceAmount] = useState(String(detail.advance_remaining || 0));
  const [holdRetention, setHoldRetention] = useState(false);
  const [remarks, setRemarks] = useState(detail.remarks ?? "");
  const [submitting, startSubmit] = useTransition();

  const setLine = (i: number, patch: Partial<TaxLineForm>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const calc = useMemo(
    () =>
      computeApproval({
        lines: toLines(lines),
        otherCharges: parseFloat(otherCharges || "0"),
        tdsPct: parseFloat(tdsPct || "0"),
        deductAdvance,
        advanceAmount: parseFloat(advanceAmount || "0"),
        holdRetention,
        advanceRemaining: detail.advance_remaining,
      }),
    [lines, otherCharges, tdsPct, deductAdvance, advanceAmount, holdRetention, detail.advance_remaining]
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    startSubmit(async () => {
      const res = await accountsApproveInvoice(projectId, invoiceId, {
        lines: toLines(lines),
        otherCharges: parseFloat(otherCharges || "0"),
        tdsPct: parseFloat(tdsPct || "0"),
        deductAdvance,
        advanceAmount: parseFloat(advanceAmount || "0"),
        holdRetention,
        remarks,
      });
      if (!res.ok) onError(res.error);
      else onDone();
    });
  };

  const row = (label: string, value: string, strong = false) => (
    <div className={cn("flex justify-between", strong && "font-semibold")}>
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );

  return (
    <Card className="border-blue-500/40">
      <CardHeader>
        <CardTitle className="text-base">Book {detail.invoice_no}</CardTitle>
        <CardDescription>
          Confirm the GST lines and set TDS, advance and retention. This books the base
          value against the budget.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_3rem_3rem_3rem] items-center gap-1">
                <Input
                  inputMode="decimal"
                  value={l.base}
                  onChange={(e) => setLine(i, { base: e.target.value })}
                  aria-label={`Base ${i + 1}`}
                />
                <input className={field} value={l.sgst} onChange={(e) => setLine(i, { sgst: e.target.value })} aria-label="SGST %" />
                <input className={field} value={l.cgst} onChange={(e) => setLine(i, { cgst: e.target.value })} aria-label="CGST %" />
                <input className={field} value={l.igst} onChange={(e) => setLine(i, { igst: e.target.value })} aria-label="IGST %" />
              </div>
            ))}
            {lines.length < MAX_TAX_LINES && (
              <button
                type="button"
                onClick={() => setLines((ls) => [...ls, emptyTaxLine()])}
                className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
              >
                <Plus className="size-3" /> Add line
              </button>
            )}
            <label className="text-muted-foreground flex items-center justify-between gap-2 text-sm">
              Other charges
              <input className={cn(field, "w-28")} inputMode="decimal" value={otherCharges} onChange={(e) => setOtherCharges(e.target.value)} aria-label="Other charges" />
            </label>
            <label className="text-muted-foreground flex items-center justify-between gap-2 text-sm">
              TDS %
              <input className={cn(field, "w-28")} inputMode="decimal" value={tdsPct} onChange={(e) => setTdsPct(e.target.value)} aria-label="TDS percent" />
            </label>
            {detail.advance_remaining > 0 && (
              <div className="space-y-1">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={deductAdvance} onChange={(e) => setDeductAdvance(e.target.checked)} />
                  Deduct advance (up to {inr(detail.advance_remaining)})
                </label>
                {deductAdvance && (
                  <input className={cn(field, "w-full")} inputMode="decimal" value={advanceAmount} onChange={(e) => setAdvanceAmount(e.target.value)} aria-label="Advance to deduct" />
                )}
              </div>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={holdRetention} onChange={(e) => setHoldRetention(e.target.checked)} />
              Hold 5% retention (release after 12 months)
            </label>
            <Input placeholder="Remarks (optional)" value={remarks} onChange={(e) => setRemarks(e.target.value)} aria-label="Remarks" />
          </div>

          <div className="space-y-1 text-sm">
            {row("Base", inr(calc.baseSum))}
            {row("GST", inr(calc.gstSum))}
            {row("Other charges", inr(parseFloat(otherCharges || "0")))}
            {row("Subtotal", inr(calc.subtotal))}
            {calc.deduct > 0 && row("Less advance", `− ${inr(calc.deduct)}`)}
            {row("Less TDS", `− ${inr(calc.tdsAmount)}`)}
            {calc.retentionAmount > 0 && row("Less retention", `− ${inr(calc.retentionAmount)}`)}
            <div className="my-1 border-t" />
            {row("Amount payable", inr(calc.payable), true)}
            <div className="flex items-center gap-2 pt-3">
              <Button type="submit" size="sm" disabled={pending || submitting}>
                <Check className="size-4" /> Book invoice
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={onCancel}>
                Cancel
              </Button>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/** Raise a (partial) payment request against an approved invoice. */
function RaisePaymentForm({
  projectId,
  invoiceId,
  remaining,
  pending,
  onCancel,
  onError,
  onDone,
}: {
  projectId: string;
  invoiceId: string;
  remaining: number;
  pending: boolean;
  onCancel: () => void;
  onError: (e: string) => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState(String(remaining));
  const [priority, setPriority] = useState("medium");
  const [notes, setNotes] = useState("");
  const [submitting, startSubmit] = useTransition();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(amount || "0");
    if (!(amt > 0) || amt > remaining) return onError(`Enter an amount up to ${inr(remaining)}.`);
    startSubmit(async () => {
      const res = await raisePaymentRequest(projectId, invoiceId, amt, priority, notes);
      if (!res.ok) onError(res.error);
      else onDone();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Request payment</CardTitle>
        <CardDescription>Up to {inr(remaining)} remaining on this invoice.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="sm:w-40" aria-label="Amount" />
          <select className={cn(field, "sm:w-32")} value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Priority">
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
          <Input placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} className="sm:flex-1" aria-label="Notes" />
          <Button type="submit" size="sm" disabled={pending || submitting}>
            Raise
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
