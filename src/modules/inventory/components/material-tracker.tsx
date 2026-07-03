"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import type { ConsumptionEntry, MaterialStock } from "@/modules/inventory/types";
import { deleteConsumption, recordConsumption } from "@/modules/inventory/actions";

type Result = { ok: true } | { ok: false; error: string };

const field = "border-input bg-background h-9 rounded-md border px-2 text-sm";
const fmtQty = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

export function MaterialTracker({
  projectId,
  stock,
  consumption,
  canRecord,
  canManage,
}: {
  projectId: string;
  stock: MaterialStock[];
  consumption: ConsumptionEntry[];
  canRecord: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [showLog, setShowLog] = useState(false);

  const [lineId, setLineId] = useState("");
  const [qty, setQty] = useState<number>(0);
  const [on, setOn] = useState("");
  const [note, setNote] = useState("");

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

  const selected = useMemo(() => stock.find((s) => s.budget_line_id === lineId), [stock, lineId]);

  const submit = () => {
    if (!lineId || !(qty > 0)) return;
    run(
      () => recordConsumption(projectId, lineId, qty, on, note),
      () => {
        setRecording(false);
        setLineId("");
        setQty(0);
        setOn("");
        setNote("");
      }
    );
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-md border px-4 py-2 text-sm">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">
          Received comes from goods receipts on this project&apos;s purchase orders.
        </p>
        {canRecord && stock.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => setRecording((r) => !r)}>
            <Plus className="size-4" /> Record consumption
          </Button>
        )}
      </div>

      {recording && canRecord && (
        <Card>
          <CardContent className="space-y-2 pt-6">
            <div className="flex flex-col gap-2 sm:flex-row">
              <select
                className={cn(field, "sm:flex-1")}
                value={lineId}
                onChange={(e) => setLineId(e.target.value)}
                aria-label="Material"
              >
                <option value="">Choose material…</option>
                {stock.map((s) => (
                  <option key={s.budget_line_id} value={s.budget_line_id}>
                    {s.description}
                    {s.unit ? ` (${s.unit})` : ""} — {fmtQty(s.on_hand)} on hand
                  </option>
                ))}
              </select>
              <Input
                type="number"
                placeholder="Qty"
                value={qty || ""}
                min={0}
                max={selected?.on_hand}
                onChange={(e) => setQty(e.target.valueAsNumber || 0)}
                className="sm:w-28"
                aria-label="Consumed quantity"
              />
              <input
                type="date"
                value={on}
                onChange={(e) => setOn(e.target.value)}
                className={cn(field, "sm:w-40")}
                aria-label="Consumed on"
              />
            </div>
            <Input
              placeholder="Note (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-label="Consumption note"
            />
            {selected && qty > selected.on_hand && (
              <p className="text-destructive text-xs">
                Only {fmtQty(selected.on_hand)} on hand.
              </p>
            )}
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={pending || !lineId || !(qty > 0) || (!!selected && qty > selected.on_hand)}
                onClick={submit}
              >
                Save
              </Button>
              <Button size="sm" variant="outline" onClick={() => setRecording(false)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          {stock.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nothing received yet. Once goods are received against this project&apos;s purchase
              orders, each budget item will appear here.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-left text-xs">
                    <th className="py-1 font-medium">Package</th>
                    <th className="py-1 font-medium">Item</th>
                    <th className="py-1 font-medium">Unit</th>
                    <th className="w-24 py-1 text-right font-medium">Ordered</th>
                    <th className="w-24 py-1 text-right font-medium">Received</th>
                    <th className="w-24 py-1 text-right font-medium">Consumed</th>
                    <th className="w-24 py-1 text-right font-medium">On hand</th>
                  </tr>
                </thead>
                <tbody>
                  {stock.map((s) => (
                    <tr key={s.budget_line_id} className="border-b last:border-0">
                      <td className="text-muted-foreground py-1">{s.package_name}</td>
                      <td className="py-1">{s.description}</td>
                      <td className="text-muted-foreground py-1">{s.unit ?? ""}</td>
                      <td className="text-muted-foreground py-1 text-right">{fmtQty(s.ordered)}</td>
                      <td className="py-1 text-right">{fmtQty(s.received)}</td>
                      <td className="py-1 text-right">{fmtQty(s.consumed)}</td>
                      <td
                        className={cn(
                          "py-1 text-right font-medium",
                          s.on_hand === 0 && "text-muted-foreground"
                        )}
                      >
                        {fmtQty(s.on_hand)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Consumption history ------------------------------------------------- */}
      {consumption.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowLog((s) => !s)}
            className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-2"
          >
            {showLog ? "Hide" : "Show"} consumption history ({consumption.length})
          </button>
          {showLog && (
            <Card className="mt-2">
              <CardContent className="pt-6">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-muted-foreground border-b text-left text-xs">
                        <th className="py-1 font-medium">Date</th>
                        <th className="py-1 font-medium">Item</th>
                        <th className="w-20 py-1 text-right font-medium">Qty</th>
                        <th className="py-1 font-medium">Note</th>
                        <th className="py-1 font-medium">By</th>
                        <th className="py-1" />
                      </tr>
                    </thead>
                    <tbody>
                      {consumption.map((c) => (
                        <tr key={c.id} className="border-b last:border-0">
                          <td className="text-muted-foreground py-1">{c.consumed_on}</td>
                          <td className="py-1">{c.description}</td>
                          <td className="py-1 text-right">{fmtQty(c.qty)}</td>
                          <td className="text-muted-foreground py-1">{c.note ?? "—"}</td>
                          <td className="text-muted-foreground py-1">{c.recorded_name ?? "—"}</td>
                          <td className="py-1 text-right">
                            {canManage && c.can_delete && (
                              <button
                                type="button"
                                disabled={pending}
                                onClick={() => run(() => deleteConsumption(projectId, c.id))}
                                className="text-muted-foreground hover:text-destructive"
                                title="Remove entry"
                                aria-label="Remove consumption entry"
                              >
                                <Trash2 className="size-4" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
