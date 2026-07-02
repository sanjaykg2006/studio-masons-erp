"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ChangeEvent, useRef, useState, useTransition } from "react";
import { ArrowLeft, Check, Download, Upload } from "lucide-react";

import { cn } from "@/lib/utils";
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
  type OrderDetail,
  type OrderLine,
  type OrderStatus,
} from "@/modules/procurement/types";
import {
  amendOrderLine,
  approveOrder,
  getOrderDocumentUrl,
  recordReceipt,
  releaseOrder,
  reviewOrder,
  seniorBypassOrder,
  startAmendment,
  uploadOrderDocument,
} from "@/modules/procurement/order-actions";

type Result = { ok: true } | { ok: false; error: string };

const STATUS_TONE: Record<OrderStatus, string> = {
  draft: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  issued: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  closed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  amending: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
};

const field = "border-input bg-background h-8 rounded-md border px-2 text-sm";
const fmt = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtQty = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

export function OrderDetailView({
  projectId,
  order,
  lines,
}: {
  projectId: string;
  order: OrderDetail;
  lines: OrderLine[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [receiving, setReceiving] = useState(false);
  const [receivedOn, setReceivedOn] = useState("");
  const [notes, setNotes] = useState("");
  const [qtys, setQtys] = useState<Record<string, number>>({});
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
  const signedOff = !!order.finance_reviewed_by && !!order.director_approved_by;
  const bypassOk = !order.over_budget || !!order.senior_bypass_by;
  const releaseReady = signedOff && bypassOk;

  const amend = () => {
    const note = window.prompt("What is changing in this amendment? (optional)") ?? "";
    run(() => startAmendment(projectId, order.id, note));
  };

  const download = async (kind: "po" | "acceptance") => {
    setError(null);
    const res = await getOrderDocumentUrl(order.id, kind);
    if (res.ok) window.open(res.url, "_blank", "noopener");
    else setError(res.error);
  };

  const upload = (kind: "po" | "acceptance", file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    run(() => uploadOrderDocument(projectId, order.id, kind, fd));
  };

  const submitReceipt = () => {
    const drafts = Object.entries(qtys)
      .filter(([, q]) => q > 0)
      .map(([order_line_id, qty]) => ({ order_line_id, qty }));
    run(
      () => recordReceipt(projectId, order.id, receivedOn, notes, drafts),
      () => {
        setReceiving(false);
        setReceivedOn("");
        setNotes("");
        setQtys({});
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

  const total = lines.reduce(
    (s, l) => s + (amendable ? editOf(l).qty * editOf(l).rate : l.amount),
    0
  );

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
            {order.over_budget && (
              <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-400">
                Over budget
              </span>
            )}
          </p>
        </div>
        {order.status === "issued" && order.can_amend && (
          <Button size="sm" variant="outline" disabled={pending} onClick={amend}>
            Amend
          </Button>
        )}
      </div>

      {error && (
        <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-md border px-4 py-2 text-sm">
          {error}
        </div>
      )}

      {/* Sign-off + release ------------------------------------------------- */}
      {isEditable && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {isAmending ? "Re-sign-off (amendment)" : "Sign-off"}
            </CardTitle>
            <CardDescription>
              Both sign-offs are needed before the PO can be released
              {order.over_budget ? ", and the MD must clear the over-budget amount" : ""}.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-4 text-sm">
            <SignRow
              label="Finance review"
              byName={order.finance_reviewed_name}
              canAct={order.can_review && !order.finance_reviewed_by}
              pending={pending}
              onAct={() => run(() => reviewOrder(projectId, order.id))}
            />
            <SignRow
              label="Director approval"
              byName={order.director_approved_name}
              canAct={order.can_approve && !order.director_approved_by}
              pending={pending}
              onAct={() => run(() => approveOrder(projectId, order.id))}
            />
            {order.over_budget && (
              <SignRow
                label="Senior (MD) bypass"
                byName={order.senior_bypass_name}
                canAct={order.can_bypass && !order.senior_bypass_by}
                pending={pending}
                onAct={() => run(() => seniorBypassOrder(projectId, order.id))}
              />
            )}
            {order.can_issue && (
              <Button
                size="sm"
                disabled={pending || !releaseReady}
                title={releaseReady ? undefined : "Needs the sign-offs (and MD bypass if over budget)"}
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
          <CardDescription>The issued PO and the vendor&apos;s acceptance letter.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <DocSlot
            label="Purchase order"
            hasFile={!!order.po_file}
            canUpload={order.can_issue}
            pending={pending}
            onDownload={() => download("po")}
            onPick={(f) => upload("po", f)}
          />
          <DocSlot
            label="Acceptance letter"
            hasFile={!!order.acceptance_file}
            canUpload={order.can_issue}
            pending={pending}
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
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-b text-left text-xs">
                <th className="py-1 font-medium">Description</th>
                <th className="w-20 py-1 text-right font-medium">Ordered</th>
                <th className="w-24 py-1 text-right font-medium">Rate</th>
                <th className="w-28 py-1 text-right font-medium">Amount</th>
                <th className="w-20 py-1 text-right font-medium">Received</th>
                <th className="w-20 py-1 text-right font-medium">Balance</th>
                {receiving && <th className="w-24 py-1 text-right font-medium">Receive now</th>}
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const balance = l.qty_ordered - l.qty_received;
                return (
                  <tr key={l.id} className="border-b last:border-0">
                    <td className="py-1">
                      {l.description}
                      {l.unit && <span className="text-muted-foreground"> ({l.unit})</span>}
                    </td>
                    {amendable ? (
                      <>
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
                        <td className="py-1">
                          <Input
                            type="number"
                            value={editOf(l).rate}
                            onChange={(e) => setEdit(l, { rate: e.target.valueAsNumber || 0 })}
                            onBlur={() => commitLine(l)}
                            className="h-8 text-right"
                            aria-label={`Rate ${l.description}`}
                          />
                        </td>
                        <td className="py-1 text-right">{fmt(editOf(l).qty * editOf(l).rate)}</td>
                      </>
                    ) : (
                      <>
                        <td className="py-1 text-right">{fmtQty(l.qty_ordered)}</td>
                        <td className="py-1 text-right">{fmt(l.rate)}</td>
                        <td className="py-1 text-right">{fmt(l.amount)}</td>
                      </>
                    )}
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
                <td colSpan={3} className="py-1 text-right">
                  Total
                </td>
                <td className="py-1 text-right">{fmt(total)}</td>
                <td colSpan={receiving ? 3 : 2} />
              </tr>
            </tfoot>
          </table>

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
              <Input
                placeholder="Notes (optional)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="sm:w-64"
                aria-label="Receipt notes"
              />
              <Button size="sm" disabled={pending} onClick={submitReceipt}>
                Save receipt
              </Button>
              <Button size="sm" variant="outline" onClick={() => setReceiving(false)}>
                Cancel
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
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
  pending,
  onDownload,
  onPick,
}: {
  label: string;
  hasFile: boolean;
  canUpload: boolean;
  pending: boolean;
  onDownload: () => void;
  onPick: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onPick(file);
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
            <Button size="sm" variant="outline" disabled={pending} onClick={() => inputRef.current?.click()}>
              <Upload className="size-4" /> {hasFile ? "Replace" : "Upload"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
