"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ChangeEvent, useRef, useState, useTransition } from "react";
import { ArrowLeft, Check, Download, Paperclip, Undo2, Upload } from "lucide-react";

import { sendWithFiles } from "@/core/uploads/client";
import { cn } from "@/lib/utils";
import { RejectionNote } from "@/modules/access/components/rejection-note";
import type { RejectionNote as Rejection } from "@/modules/access/rejection-notes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ORDER_STATUS_LABEL,
  VENDOR_TYPE_LABEL,
  type OrderDetail,
  type OrderLine,
  type OrderStatus,
} from "@/modules/procurement/types";
import {
  addReceiptFiles,
  amendOrderLine,
  approveOrderCancel,
  decideOrder,
  getOrderDocumentUrl,
  getReceiptFileUrl,
  recordReceipt,
  rejectOrderCancel,
  releaseOrder,
  requestOrderCancel,
  restartOrderApproval,
  seniorBypassOrder,
  cancelAmendment,
  startAmendment,
  uploadOrderDocument,
} from "@/modules/procurement/order-actions";
import { PoDocumentPanel } from "@/modules/procurement/components/po-document-panel";
import type { BillingBranch } from "@/modules/finance/types";
import type { OrderReceipt } from "@/modules/procurement/order-data";

type Result = { ok: true } | { ok: false; error: string };

const STATUS_TONE: Record<OrderStatus, string> = {
  draft: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  issued: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  closed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  amending: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
  cancelled: "bg-muted text-muted-foreground",
};

const field = "border-input bg-background h-8 rounded-md border px-2 text-sm";
const fmt = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtQty = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

export function OrderDetailView({
  projectId,
  order,
  lines,
  project,
  branches,
  receipts,
  invoices,
  rejection,
}: {
  projectId: string;
  order: OrderDetail;
  lines: OrderLine[];
  project: { name: string; code: string | null; client: string | null; location: string | null } | null;
  /** Active billing branches from Finance, for the PO document's GST block. */
  branches: BillingBranch[];
  /** Every goods receipt recorded against this PO, newest first. */
  receipts: OrderReceipt[];
  /** Invoices already booked against this PO, for the receipt picker. */
  invoices: { id: string; label: string; vendor_invoice_date: string }[];
  /** Why sign-off was last refused, while it stands refused. */
  rejection?: Rejection;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [receiving, setReceiving] = useState(false);
  const [receivedOn, setReceivedOn] = useState("");
  const [notes, setNotes] = useState("");
  const [qtys, setQtys] = useState<Record<string, number>>({});
  // Either a booked invoice or, when the goods beat the paperwork, its number.
  const [invoiceId, setInvoiceId] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const grnRef = useRef<HTMLInputElement>(null);
  const extrasRef = useRef<HTMLInputElement>(null);
  const [edits, setEdits] = useState<Record<string, { qty: number; rate: number }>>({});

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

  const isEditable = order.status === "draft" || order.status === "amending";
  const isAmending = order.status === "amending";
  // Its approval stages (Access Control → Approval flows) decide the sign-off.
  const signedOff = order.approval_status === "approved";
  // An over-budget PO also needs the senior sign-off before it can be released.
  const overBudgetBlocked = order.over_budget && !order.senior_bypass_by;
  const cancelRequested = order.status === "issued" && !!order.cancel_requested_by;

  const amend = () => {
    // Cancelling the prompt returns null - that means "don't", not "no note".
    // It used to fall through to ?? "" and open the amendment anyway.
    const note = window.prompt("What is changing in this amendment? (optional)");
    if (note === null) return;
    run(() => startAmendment(projectId, order.id, note));
  };

  const undoAmendment = () => {
    if (
      confirm(
        "Cancel this amendment? The PO goes back to how it was, with its original sign-offs, and any line edits are undone."
      )
    ) {
      run(() => cancelAmendment(projectId, order.id));
    }
  };

  const requestCancel = () => {
    const reason = window.prompt("Why is this PO being cancelled? (the Director will review)");
    if (reason && reason.trim()) run(() => requestOrderCancel(projectId, order.id, reason.trim()));
  };

  const download = async (kind: "po" | "acceptance" | "support") => {
    setError(null);
    const res = await getOrderDocumentUrl(order.id, kind);
    if (res.ok) window.open(res.url, "_blank", "noopener");
    else setError(res.error);
  };

  const upload = (kind: "po" | "acceptance", file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    run(() => sendWithFiles(fd, (f) => uploadOrderDocument(projectId, order.id, kind, f)));
  };

  const openReceiptFile = async (fileId: string) => {
    setError(null);
    const res = await getReceiptFileUrl(fileId);
    if (res.ok) window.open(res.url, "_blank", "noopener");
    else setError(res.error);
  };

  const addToReceipt = (receiptId: string, kind: "grn" | "extras", files: File[]) => {
    const fd = new FormData();
    for (const f of files) fd.append(kind, f);
    run(() => sendWithFiles(fd, (f) => addReceiptFiles(projectId, order.id, receiptId, f)));
  };

  const submitReceipt = () => {
    const drafts = Object.entries(qtys)
      .filter(([, q]) => q > 0)
      .map(([order_line_id, qty]) => ({ order_line_id, qty }));
    // Checked here, before any file is sent, so a forgotten quantity doesn't
    // cost a wasted upload.
    if (drafts.length === 0) return setError("Enter the quantity received on at least one line.");
    const grn = grnRef.current?.files?.[0];
    if (!grn) return setError("Attach the GRN for this delivery.");
    const fd = new FormData();
    fd.append("grn", grn);
    for (const f of Array.from(extrasRef.current?.files ?? [])) fd.append("extras", f);
    run(
      () =>
        sendWithFiles(fd, (f) =>
          recordReceipt(projectId, order.id, receivedOn, notes, drafts, invoiceId, invoiceNo, f)
        ),
      () => {
        setReceiving(false);
        setReceivedOn("");
        setNotes("");
        setQtys({});
        setInvoiceId("");
        setInvoiceNo("");
      }
    );
  };

  const amendable = isAmending && order.can_amend;
  const editOf = (l: OrderLine) => edits[l.id] ?? { qty: l.qty_ordered, rate: l.rate };
  const setEdit = (l: OrderLine, patch: Partial<{ qty: number; rate: number }>) =>
    setEdits((e) => ({ ...e, [l.id]: { ...editOf(l), ...patch } }));
  const commitLine = (l: OrderLine) => {
    const v = edits[l.id];
    if (!v || (v.qty === l.qty_ordered && v.rate === l.rate)) return;
    run(() => amendOrderLine(projectId, order.id, l.id, v.qty, v.rate));
  };

  const qtyOf = (l: OrderLine) => (amendable ? editOf(l).qty : l.qty_ordered);
  const rateOf = (l: OrderLine) => (amendable ? editOf(l).rate : l.rate);
  const vendorTotal = lines.reduce((s, l) => s + qtyOf(l) * rateOf(l), 0);
  const budgetTotal = lines.reduce((s, l) => s + qtyOf(l) * (l.budget_rate ?? 0), 0);

  return (
    <div className="space-y-6">
      <Link
        href={`/projects/${projectId}/orders`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" /> Purchase orders
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {order.po_number ?? "PO"} · {order.vendor_name}
          </h1>
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_TONE[order.status])}>
              {ORDER_STATUS_LABEL[order.status]}
            </span>
            {order.version_no > 1 && <span>v{order.version_no}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {order.status === "issued" && order.can_amend && (
            <Button size="sm" variant="outline" disabled={pending} onClick={amend}>
              Amend
            </Button>
          )}
          {order.status === "issued" && order.can_cancel && !cancelRequested && (
            <Button size="sm" variant="outline" disabled={pending} onClick={requestCancel}>
              Request cancellation
            </Button>
          )}
        </div>
      </div>

      <RejectionNote note={rejection} label="Sign-off refused" />

      {/* While receiving, the message shows beside Save receipt instead —
          up here it is off-screen from the form. */}
      {error && !receiving && (
        <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-md border px-4 py-2 text-sm">
          {error}
        </div>
      )}

      {/* Cancellation ------------------------------------------------------- */}
      {cancelRequested && (
        <Card className="border-red-500/40">
          <CardHeader>
            <CardTitle className="text-base text-red-700 dark:text-red-400">Cancellation requested</CardTitle>
            <CardDescription>
              {order.cancel_requested_name ?? "Someone"} asked to cancel this PO
              {order.cancel_reason ? `: “${order.cancel_reason}”` : "."}
            </CardDescription>
          </CardHeader>
          {order.can_approve_cancel && (
            <CardContent className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                disabled={pending}
                onClick={() => run(() => approveOrderCancel(projectId, order.id))}
              >
                Approve cancellation
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => run(() => rejectOrderCancel(projectId, order.id))}
              >
                Decline
              </Button>
            </CardContent>
          )}
        </Card>
      )}

      {order.status === "cancelled" && (
        <Card className="border-muted">
          <CardHeader>
            <CardTitle className="text-base">This PO was cancelled</CardTitle>
            <CardDescription>
              Cancelled by {order.cancelled_name ?? "a Director"}
              {order.cancel_reason ? `: “${order.cancel_reason}”` : "."} The un-received
              balance is free to re-award to another vendor.
            </CardDescription>
          </CardHeader>
          {order.can_issue && order.intent_id && (
            <CardContent>
              <Button size="sm" asChild>
                <Link href={`/projects/${projectId}/intents/${order.intent_id}/order`}>
                  Re-award to another vendor
                </Link>
              </Button>
            </CardContent>
          )}
        </Card>
      )}

      {/* Vendor ------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Vendor</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <span className="font-medium">{order.vendor_name}</span>
            <span className="text-muted-foreground">{VENDOR_TYPE_LABEL[order.vendor_type]}</span>
            {order.vendor_trade && <span className="text-muted-foreground">{order.vendor_trade}</span>}
            {order.vendor_contact_name && (
              <span className="text-muted-foreground">{order.vendor_contact_name}</span>
            )}
            {order.vendor_contact_phone && (
              <span className="text-muted-foreground">{order.vendor_contact_phone}</span>
            )}
            {order.vendor_contact_email && (
              <span className="text-muted-foreground">{order.vendor_contact_email}</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Sign-off + release ------------------------------------------------- */}
      {isEditable && (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">
                {isAmending ? "Re-sign-off (amendment)" : "Sign-off"}
              </CardTitle>
              <CardDescription>
                {isAmending
                  ? "Opened by mistake? Cancelling puts the PO back as it was, with its original sign-offs."
                  : "The PO goes through its approval stages before it can be released."}
              </CardDescription>
            </div>
            {isAmending && order.can_amend && (
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={undoAmendment}
              >
                <Undo2 className="size-4" /> Cancel amendment
              </Button>
            )}
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-4 text-sm">
            {order.approval_status === "approved" ? (
              <span className="text-emerald-600">
                Signed off
                {order.finance_reviewed_name && ` · ${order.finance_reviewed_name}`}
                {order.director_approved_name &&
                  order.director_approved_name !== order.finance_reviewed_name &&
                  ` → ${order.director_approved_name}`}
              </span>
            ) : order.approval_status === "pending" ? (
              <span className="flex flex-wrap items-center gap-2">
                <span>Waiting for {order.stage_label ?? "approval"}</span>
                {order.wait_reason && (
                  <span className="text-muted-foreground basis-full text-xs">
                    {order.wait_reason}
                  </span>
                )}
                {order.can_decide && order.approval_id && (
                  <>
                    <Button
                      size="sm"
                      disabled={pending}
                      onClick={() =>
                        run(() => decideOrder(projectId, order.id, order.approval_id!, true, ""))
                      }
                    >
                      <Check className="size-4" /> Give sign-off
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => {
                        const note = window.prompt("Refuse this sign-off — reason?");
                        if (note === null) return;
                        run(() => decideOrder(projectId, order.id, order.approval_id!, false, note));
                      }}
                    >
                      Refuse
                    </Button>
                  </>
                )}
              </span>
            ) : (
              <span className="flex flex-wrap items-center gap-2">
                <span
                  className={
                    order.approval_status === "rejected" ? "text-destructive" : "text-muted-foreground"
                  }
                >
                  {order.approval_status === "rejected"
                    ? "Sign-off refused"
                    : "Not sent for approval yet"}
                </span>
                {order.can_issue && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => run(() => restartOrderApproval(projectId, order.id))}
                  >
                    Send for approval
                  </Button>
                )}
              </span>
            )}
            {order.over_budget && (
              <SignRow
                label="Over-budget sign-off"
                byName={order.senior_bypass_name}
                canAct={order.can_bypass && !order.senior_bypass_by}
                pending={pending}
                onAct={() => run(() => seniorBypassOrder(projectId, order.id))}
              />
            )}
            {order.can_issue && (
              <Button
                size="sm"
                disabled={pending || !signedOff || overBudgetBlocked}
                title={
                  !signedOff
                    ? "Its approval isn't complete yet"
                    : overBudgetBlocked
                      ? "Over budget — needs the senior sign-off"
                      : undefined
                }
                onClick={() => run(() => releaseOrder(projectId, order.id))}
              >
                {isAmending ? "Release amendment" : "Release PO"}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Documents ---------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Documents</CardTitle>
          <CardDescription>The supporting quote, the issued PO, and the vendor&apos;s acceptance letter.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {order.po_number && (
            <PoDocumentPanel order={order} lines={lines} project={project} branches={branches} />
          )}
          <DocSlot
            label="Supporting document"
            hasFile={!!order.support_file}
            canUpload={false}
            onDownload={() => download("support")}
            onPick={() => {}}
          />
          <DocSlot
            label="Purchase order"
            hasFile={!!order.po_file}
            canUpload={order.can_issue}
            onDownload={() => download("po")}
            onPick={(f) => upload("po", f)}
          />
          <DocSlot
            label="Acceptance letter"
            hasFile={!!order.acceptance_file}
            canUpload={order.can_issue}
            onDownload={() => download("acceptance")}
            onPick={(f) => upload("acceptance", f)}
          />
        </CardContent>
      </Card>

      {/* Lines -------------------------------------------------------------- */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Order lines</CardTitle>
          {order.status === "issued" && order.can_receive && !receiving && (
            <Button size="sm" variant="outline" onClick={() => setReceiving(true)}>
              Record receipt
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left text-xs">
                  <th className="py-1 font-medium">Description</th>
                  <th className="py-1 font-medium">Location</th>
                  <th className="py-1 font-medium">Unit</th>
                  <th className="w-20 py-1 text-right font-medium">Qty</th>
                  <th className="w-24 py-1 text-right font-medium">Budget Price</th>
                  <th className="w-28 py-1 text-right font-medium">Budget Amount</th>
                  <th className="w-24 py-1 text-right font-medium">Vendor Rate</th>
                  <th className="w-28 py-1 text-right font-medium">Vendor Amount</th>
                  <th className="w-20 py-1 text-right font-medium">Received</th>
                  <th className="w-20 py-1 text-right font-medium">Balance</th>
                  {receiving && <th className="w-24 py-1 text-right font-medium">Receive now</th>}
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const qty = qtyOf(l);
                  const rate = rateOf(l);
                  const budgetAmt = qty * (l.budget_rate ?? 0);
                  const vendorAmt = qty * rate;
                  const over = (l.budget_rate ?? 0) > 0 && vendorAmt > budgetAmt;
                  const balance = l.qty_ordered - l.qty_received;
                  return (
                    <tr key={l.id} className="border-b last:border-0">
                      <td className="py-1">{l.description}</td>
                      <td className="text-muted-foreground py-1">{l.location ?? "—"}</td>
                      <td className="text-muted-foreground py-1">{l.unit ?? ""}</td>
                      {amendable ? (
                        <td className="py-1">
                          <Input
                            type="number"
                            value={editOf(l).qty}
                            min={l.qty_received}
                            onChange={(e) => setEdit(l, { qty: e.target.valueAsNumber || 0 })}
                            onBlur={() => commitLine(l)}
                            className="h-8 text-right"
                            aria-label={`Ordered qty ${l.description}`}
                          />
                        </td>
                      ) : (
                        <td className="py-1 text-right">{fmtQty(l.qty_ordered)}</td>
                      )}
                      <td className="text-muted-foreground py-1 text-right">
                        {l.budget_rate == null ? "—" : fmt(l.budget_rate)}
                      </td>
                      <td className="text-muted-foreground py-1 text-right">
                        {l.budget_rate == null ? "—" : fmt(budgetAmt)}
                      </td>
                      {amendable ? (
                        <td className="py-1">
                          <Input
                            type="number"
                            value={editOf(l).rate}
                            onChange={(e) => setEdit(l, { rate: e.target.valueAsNumber || 0 })}
                            onBlur={() => commitLine(l)}
                            className="h-8 text-right"
                            aria-label={`Vendor rate ${l.description}`}
                          />
                        </td>
                      ) : (
                        <td className="py-1 text-right">{fmt(l.rate)}</td>
                      )}
                      <td className={cn("py-1 text-right", over && "text-red-600 dark:text-red-400")}>
                        {fmt(vendorAmt)}
                      </td>
                      <td className="py-1 text-right">{fmtQty(l.qty_received)}</td>
                      <td className={cn("py-1 text-right", balance === 0 && "text-emerald-600")}>
                        {fmtQty(balance)}
                      </td>
                      {receiving && (
                        <td className="py-1 text-right">
                          {balance > 0 ? (
                            <Input
                              type="number"
                              value={qtys[l.id] || ""}
                              max={balance}
                              onChange={(e) =>
                                setQtys((q) => ({ ...q, [l.id]: e.target.valueAsNumber || 0 }))
                              }
                              className="h-8 text-right"
                              placeholder="0"
                              aria-label={`Receive ${l.description}`}
                            />
                          ) : (
                            <Check className="ml-auto size-4 text-emerald-600" />
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t font-medium">
                  <td colSpan={5} className="py-1 text-right">
                    Total
                  </td>
                  <td className="text-muted-foreground py-1 text-right">{fmt(budgetTotal)}</td>
                  <td />
                  <td className="py-1 text-right">{fmt(vendorTotal)}</td>
                  <td colSpan={receiving ? 3 : 2} />
                </tr>
              </tfoot>
            </table>
          </div>

          {receiving && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
              <label className="text-muted-foreground flex items-center gap-2 text-sm">
                Received on
                <input
                  type="date"
                  value={receivedOn}
                  onChange={(e) => setReceivedOn(e.target.value)}
                  className={field}
                  aria-label="Received on"
                />
              </label>
              {/* The bill this delivery is against. Pick a booked invoice when
                  there is one; otherwise type the number, since goods usually
                  arrive before Finance has entered it. */}
              {invoices.length > 0 && (
                <label className="text-muted-foreground flex items-center gap-2 text-sm">
                  Invoice
                  <select
                    value={invoiceId}
                    onChange={(e) => setInvoiceId(e.target.value)}
                    className={field}
                    aria-label="Booked invoice"
                  >
                    <option value="">Not booked yet</option>
                    {invoices.map((iv) => (
                      <option key={iv.id} value={iv.id}>
                        {iv.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {!invoiceId && (
                <Input
                  placeholder="Vendor invoice no. (optional)"
                  value={invoiceNo}
                  onChange={(e) => setInvoiceNo(e.target.value)}
                  className="sm:w-52"
                  aria-label="Vendor invoice number"
                />
              )}
              <Input
                placeholder="Notes (optional)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="sm:w-64"
                aria-label="Receipt notes"
              />
              <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-2">
                <label className="text-muted-foreground flex items-center gap-2 text-sm">
                  GRN <span className="text-destructive">*</span>
                  <input ref={grnRef} type="file" className="text-xs" aria-label="GRN document" />
                </label>
                <label className="text-muted-foreground flex items-center gap-2 text-sm">
                  Photos / challan (optional)
                  <input
                    ref={extrasRef}
                    type="file"
                    multiple
                    className="text-xs"
                    aria-label="Extra receipt files"
                  />
                </label>
              </div>
              {error && (
                <p role="alert" className="text-destructive w-full text-sm">
                  {error}
                </p>
              )}
              <Button size="sm" disabled={pending} onClick={submitReceipt}>
                Save receipt
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setReceiving(false);
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          )}
        </CardContent>      </Card>

      {/* Goods receipt history ------------------------------------------- */}
      {receipts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Goods received</CardTitle>
            <CardDescription>
              Every delivery recorded against this PO, newest first.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {receipts.map((r) => (
              <div key={r.id} className="border-b pb-3 last:border-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-medium">{r.received_on}</span>
                  <span className="text-muted-foreground text-xs">
                    {r.recorded_name ?? "—"}
                    {/* A linked invoice wins over a typed number: it is the one
                        that can actually be reconciled against Finance. */}
                    {r.invoice_ref
                      ? ` · Invoice ${r.invoice_ref}`
                      : r.invoice_no
                        ? ` · Invoice ${r.invoice_no} (not booked)`
                        : " · No invoice reference"}
                  </span>
                </div>
                <ul className="text-muted-foreground mt-1 space-y-0.5 text-xs">
                  {r.lines.map((l, n) => (
                    <li key={n}>
                      {l.description} — {fmt(l.qty_received)} {l.unit ?? ""}
                    </li>
                  ))}
                </ul>
                {r.notes && <p className="mt-1 text-xs italic">{r.notes}</p>}
                <ReceiptFiles
                  files={r.files}
                  canAdd={order.can_receive}
                  onOpen={openReceiptFile}
                  onAdd={(kind, files) => addToReceipt(r.id, kind, files)}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/**
 * A receipt's GRN and extra files. Add-only: a missing GRN (receipts from before
 * it was required) can be attached once, extras any time; nothing is replaced.
 */
function ReceiptFiles({
  files,
  canAdd,
  onOpen,
  onAdd,
}: {
  files: OrderReceipt["files"];
  canAdd: boolean;
  onOpen: (fileId: string) => void;
  onAdd: (kind: "grn" | "extras", files: File[]) => void;
}) {
  const grnRef = useRef<HTMLInputElement>(null);
  const extrasRef = useRef<HTMLInputElement>(null);
  const hasGrn = files.some((f) => f.kind === "grn");
  const pick = (kind: "grn" | "extras") => (e: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    if (picked.length) onAdd(kind, picked);
    e.target.value = "";
  };
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
      {!hasGrn && (
        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-700 dark:text-amber-400">
          GRN missing
        </span>
      )}
      {files.map((f) => (
        <button
          key={f.id}
          type="button"
          onClick={() => onOpen(f.id)}
          className="inline-flex items-center gap-1 underline underline-offset-2"
        >
          <Paperclip className="size-3" />
          {f.kind === "grn" ? `GRN · ${f.name}` : f.name}
        </button>
      ))}
      {canAdd && (
        <>
          <input ref={grnRef} type="file" className="hidden" onChange={pick("grn")} aria-label="Attach GRN" />
          <input
            ref={extrasRef}
            type="file"
            multiple
            className="hidden"
            onChange={pick("extras")}
            aria-label="Add receipt files"
          />
          {!hasGrn && (
            <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => grnRef.current?.click()}>
              <Upload className="size-3" /> Attach GRN
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => extrasRef.current?.click()}>
            <Upload className="size-3" /> Add files
          </Button>
        </>
      )}
    </div>
  );
}

function SignRow({
  label,
  byName,
  canAct,
  pending,
  onAct,
}: {
  label: string;
  byName: string | null;
  canAct: boolean;
  pending: boolean;
  onAct: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      {byName ? (
        <span className="inline-flex items-center gap-1 text-emerald-600">
          <Check className="size-4" /> {label} · {byName}
        </span>
      ) : (
        <span className="text-muted-foreground">{label}: pending</span>
      )}
      {canAct && (
        <Button size="sm" variant="outline" disabled={pending} onClick={onAct}>
          Sign off
        </Button>
      )}
    </div>
  );
}

function DocSlot({
  label,
  hasFile,
  canUpload,
  onDownload,
  onPick,
}: {
  label: string;
  hasFile: boolean;
  canUpload: boolean;
  onDownload: () => void;
  onPick: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setBusy(true);
      onPick(file);
      // The parent re-renders on success; this only stops a double-click
      // landing two uploads while the first is in flight.
      window.setTimeout(() => setBusy(false), 1500);
    }
    if (inputRef.current) inputRef.current.value = "";
  };
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="font-medium">{label}</span>
      <div className="flex items-center gap-2">
        {hasFile ? (
          <button
            type="button"
            onClick={onDownload}
            className="inline-flex items-center gap-1 underline underline-offset-2"
          >
            Download <Download className="size-3.5" />
          </button>
        ) : (
          <span className="text-muted-foreground text-xs">Not uploaded</span>
        )}
        {canUpload && (
          <>
            <input ref={inputRef} type="file" className="hidden" onChange={onChange} aria-label={`Upload ${label}`} />
            {/* Deliberately NOT disabled by the screen-wide `pending`: that flag
                stays true for the whole of any action plus the router refresh
                that follows it, so opening an amendment left every file picker
                dead until the page was reloaded by hand. Only this slot's own
                upload disables it. */}
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="size-4" /> {hasFile ? "Replace" : "Upload"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
