"use client";

import { useRouter } from "next/navigation";
import { Fragment, type FormEvent, useState, useTransition } from "react";
import { Check, Settings2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { inr, type BillingBranch, type FinanceOrder } from "@/modules/finance/types";
import {
  approvePoAdvance,
  payPoAdvance,
  requestPoAdvance,
  setOrderTerms,
} from "@/modules/finance/actions";

type Result = { ok: true } | { ok: false; error: string };
const field = "border-input bg-background h-9 rounded-md border px-2 text-sm";

export function OrderAdvanceTab({
  projectId,
  orders,
  branches,
}: {
  projectId: string;
  orders: FinanceOrder[];
  branches: BillingBranch[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

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

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Set each PO&apos;s contract window and billing branch, and run the advance:
        requested → Director approves → Accounts pays. Paid advances are netted off invoices.
      </p>

      {error && (
        <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-md border px-4 py-2 text-sm">
          {error}
        </div>
      )}

      <Card>
        <CardContent className="pt-6">
          {orders.length === 0 ? (
            <p className="text-muted-foreground text-sm">No released purchase orders on this project.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-left">
                    <th className="py-2 font-medium">PO / Vendor</th>
                    <th className="py-2 font-medium">Value</th>
                    <th className="py-2 font-medium">Branch / Contract</th>
                    <th className="py-2 font-medium">Advance</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => {
                    const advApproved = !!o.advance_approved_at;
                    const advPaid = !!o.advance_paid_at;
                    return (
                      <Fragment key={o.id}>
                        <tr className="border-b last:border-0">
                          <td className="py-2">
                            <div className="font-medium">{o.po_number ?? "PO"}</div>
                            <div className="text-muted-foreground text-xs">{o.vendor_name}</div>
                            {!o.acceptance_on_file && (
                              <div className="text-destructive text-[10px]">no acceptance letter</div>
                            )}
                          </td>
                          <td className="py-2">{inr(o.po_total)}</td>
                          <td className="text-muted-foreground py-2 text-xs">
                            {o.billing_branch_name ?? "— no branch"}
                            <br />
                            {o.fixed_contract
                              ? `${o.contract_start ?? "?"} → ${o.contract_end ?? "?"}`
                              : "open contract"}
                          </td>
                          <td className="py-2 text-xs">
                            {o.advance_requested ? (
                              <>
                                <div>{inr(o.advance_requested)} req.</div>
                                <div className="text-muted-foreground">
                                  {advPaid ? "paid" : advApproved ? "approved" : "awaiting approval"}
                                  {(o.advance_consumed ?? 0) > 0 &&
                                    ` · ${inr(o.advance_consumed ?? 0)} used`}
                                </div>
                              </>
                            ) : (
                              <span className="text-muted-foreground">none</span>
                            )}
                          </td>
                          <td className="py-2">
                            <div className="flex items-center justify-end gap-1">
                              {advApproved && !advPaid && o.can_pay_advance && (
                                <Button size="sm" disabled={pending} onClick={() => run(() => payPoAdvance(projectId, o.id))}>
                                  Pay advance
                                </Button>
                              )}
                              {!advApproved && o.advance_requested && o.can_approve_advance && (
                                <Button size="sm" disabled={pending} onClick={() => run(() => approvePoAdvance(projectId, o.id))}>
                                  <Check className="size-4" /> Approve advance
                                </Button>
                              )}
                              {o.can_set_terms && (
                                <button
                                  type="button"
                                  disabled={pending}
                                  onClick={() => setEditing((id) => (id === o.id ? null : o.id))}
                                  className="text-muted-foreground hover:text-foreground"
                                  title="Terms & advance"
                                  aria-label="Edit terms"
                                >
                                  <Settings2 className="size-4" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {editing === o.id && o.can_set_terms && (
                          <tr>
                            <td colSpan={5} className="pb-3">
                              <TermsForm
                                order={o}
                                branches={branches}
                                pending={pending}
                                onError={setError}
                                onSaveTerms={(t) =>
                                  run(() => setOrderTerms(projectId, o.id, t), () => setEditing(null))
                                }
                                onRequestAdvance={(amt, tds) =>
                                  run(() => requestPoAdvance(projectId, o.id, amt, tds), () => setEditing(null))
                                }
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TermsForm({
  order,
  branches,
  pending,
  onError,
  onSaveTerms,
  onRequestAdvance,
}: {
  order: FinanceOrder;
  branches: BillingBranch[];
  pending: boolean;
  onError: (e: string) => void;
  onSaveTerms: (t: { fixed: boolean; start: string | null; end: string | null; branchId: string | null }) => void;
  onRequestAdvance: (amount: number, tdsPct: number) => void;
}) {
  const [fixed, setFixed] = useState(order.fixed_contract);
  const [start, setStart] = useState(order.contract_start ?? "");
  const [end, setEnd] = useState(order.contract_end ?? "");
  const [branchId, setBranchId] = useState(order.billing_branch_id ?? "");
  const [advAmount, setAdvAmount] = useState(String(order.advance_requested ?? ""));
  const [advTds, setAdvTds] = useState(String(order.advance_tds_pct ?? 2));

  const advanceLocked = !!order.advance_approved_at;

  const saveTerms = (e: FormEvent) => {
    e.preventDefault();
    if (fixed && (!start || !end)) return onError("A fixed contract needs both dates.");
    onSaveTerms({ fixed, start: fixed ? start : null, end: fixed ? end : null, branchId: branchId || null });
  };

  const requestAdvance = () => {
    const amt = parseFloat(advAmount || "0");
    if (!(amt > 0)) return onError("Enter an advance amount.");
    onRequestAdvance(amt, parseFloat(advTds || "0"));
  };

  return (
    <Card className="border-blue-500/40">
      <CardContent className="space-y-4 pt-6">
        {/* Terms */}
        <form onSubmit={saveTerms} className="space-y-2">
          <div className="text-sm font-medium">Contract & billing</div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <select className={cn(field, "sm:w-56")} value={branchId} onChange={(e) => setBranchId(e.target.value)} aria-label="Billing branch">
              <option value="">No billing branch</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.gstin ? ` · ${b.gstin}` : ""}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={fixed} onChange={(e) => setFixed(e.target.checked)} />
              Fixed contract
            </label>
            {fixed && (
              <>
                <input type="date" className={field} value={start} onChange={(e) => setStart(e.target.value)} aria-label="Contract start" />
                <input type="date" className={field} value={end} onChange={(e) => setEnd(e.target.value)} aria-label="Contract end" />
              </>
            )}
          </div>
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            Save terms
          </Button>
        </form>

        {/* Advance request */}
        <div className="space-y-2 border-t pt-3">
          <div className="text-sm font-medium">Advance</div>
          {advanceLocked ? (
            <p className="text-muted-foreground text-xs">
              Advance of {inr(order.advance_requested ?? 0)} is already approved and can no longer be changed.
            </p>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className="text-muted-foreground flex items-center gap-1 text-sm">
                Amount
                <input className={cn(field, "w-32")} inputMode="decimal" value={advAmount} onChange={(e) => setAdvAmount(e.target.value)} aria-label="Advance amount" />
              </label>
              <label className="text-muted-foreground flex items-center gap-1 text-sm">
                TDS %
                <input className={cn(field, "w-20")} inputMode="decimal" value={advTds} onChange={(e) => setAdvTds(e.target.value)} aria-label="Advance TDS" />
              </label>
              <Button type="button" size="sm" variant="outline" disabled={pending} onClick={requestAdvance}>
                Request advance
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
