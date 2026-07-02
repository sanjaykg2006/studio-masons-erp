"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowLeft, Plus, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  COMPARISON_STATUS_LABEL,
  type ComparisonDetail,
  type Vendor,
} from "@/modules/procurement/types";
import {
  addComparisonVendor,
  awardComparison,
  removeComparisonVendor,
  setQuote,
} from "@/modules/procurement/comparison-actions";

type Result = { ok: true } | { ok: false; error: string };

const field = "border-input bg-background h-8 rounded-md border px-2 text-sm";
const fmt = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

export function ComparisonGrid({
  projectId,
  comparison,
  approvedVendors,
}: {
  projectId: string;
  comparison: ComparisonDetail;
  approvedVendors: Vendor[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [addVendor, setAddVendor] = useState("");
  // Award picks: line id -> winning vendor id.
  const [picks, setPicks] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      comparison.lines.filter((l) => l.award).map((l) => [l.id, l.award!.vendor_id])
    )
  );

  const editable = comparison.canEdit && comparison.status === "draft";
  const awardable = comparison.canAward && comparison.status === "draft";

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

  const rateOf = (lineId: string, vendorId: string) =>
    comparison.lines.find((l) => l.id === lineId)?.quotes.find((q) => q.vendor_id === vendorId)?.rate;

  const commitRate = (lineId: string, vendorId: string, raw: string) => {
    const trimmed = raw.trim();
    const next = trimmed === "" ? null : Number(trimmed);
    if (next !== null && !Number.isFinite(next)) return;
    const current = rateOf(lineId, vendorId) ?? null;
    if (next === current) return;
    run(() => setQuote(projectId, comparison.id, lineId, vendorId, next, ""));
  };

  const confirmAward = () => {
    const awards = Object.entries(picks)
      .filter(([, vendorId]) => vendorId)
      .map(([line_id, vendor_id]) => ({ line_id, vendor_id }));
    run(() => awardComparison(projectId, comparison.id, awards));
  };

  const inComparison = new Set(comparison.vendors.map((v) => v.vendor_id));
  const addable = approvedVendors.filter((v) => !inComparison.has(v.id));

  const awardedTotal = comparison.lines.reduce(
    (sum, l) => sum + (l.award ? l.award.qty * l.award.rate : 0),
    0
  );

  return (
    <div className="space-y-6">
      <Link
        href={`/projects/${projectId}/comparisons`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" /> Comparisons
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {comparison.title || comparison.package_name || "Comparison"}
          </h1>
          <p className="text-muted-foreground text-sm">
            {COMPARISON_STATUS_LABEL[comparison.status]}
            {comparison.awarded_by_name && ` · awarded by ${comparison.awarded_by_name}`}
          </p>
        </div>
        {awardable && (
          <Button
            size="sm"
            disabled={pending || Object.values(picks).every((v) => !v)}
            onClick={confirmAward}
          >
            Confirm award
          </Button>
        )}
      </div>

      {error && (
        <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-md border px-4 py-2 text-sm">
          {error}
        </div>
      )}

      {editable && addable.length > 0 && (
        <div className="flex gap-2">
          <select
            className={cn(field, "h-9 flex-1 sm:flex-none sm:w-64")}
            value={addVendor}
            onChange={(e) => setAddVendor(e.target.value)}
            aria-label="Add a vendor to compare"
          >
            <option value="">— add a vendor to compare —</option>
            {addable.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            disabled={pending || !addVendor}
            onClick={() =>
              run(
                () => addComparisonVendor(projectId, comparison.id, addVendor),
                () => setAddVendor("")
              )
            }
          >
            <Plus className="size-4" /> Add vendor
          </Button>
        </div>
      )}

      <Card>
        <CardContent className="overflow-x-auto pt-6">
          {comparison.vendors.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Add the vendors you&apos;re comparing to start entering quotes.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left text-xs">
                  <th className="py-2 font-medium">Line</th>
                  <th className="w-20 py-2 text-right font-medium">Qty</th>
                  {comparison.vendors.map((v) => (
                    <th key={v.vendor_id} className="w-28 py-2 text-right font-medium">
                      <div className="flex items-center justify-end gap-1">
                        <span className="truncate">{v.name}</span>
                        {editable && (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() =>
                              run(() => removeComparisonVendor(projectId, comparison.id, v.vendor_id))
                            }
                            className="text-muted-foreground hover:text-destructive"
                            aria-label={`Remove ${v.name}`}
                          >
                            <X className="size-3" />
                          </button>
                        )}
                      </div>
                    </th>
                  ))}
                  {(awardable || comparison.status === "awarded") && (
                    <th className="w-40 py-2 font-medium">Awarded</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {comparison.lines.map((line) => {
                  const quotedVendors = comparison.vendors.filter((v) =>
                    line.quotes.some((q) => q.vendor_id === v.vendor_id)
                  );
                  return (
                    <tr key={line.id} className="border-b last:border-0">
                      <td className="py-1">
                        {line.description}
                        {line.unit && <span className="text-muted-foreground"> ({line.unit})</span>}
                      </td>
                      <td className="py-1 text-right">{fmt(line.qty)}</td>
                      {comparison.vendors.map((v) => {
                        const rate = rateOf(line.id, v.vendor_id);
                        const isWinner = line.award?.vendor_id === v.vendor_id;
                        return (
                          <td key={v.vendor_id} className={cn("py-1 text-right", isWinner && "bg-emerald-500/10")}>
                            {editable ? (
                              <Input
                                type="number"
                                defaultValue={rate ?? ""}
                                onBlur={(e) => commitRate(line.id, v.vendor_id, e.target.value)}
                                className="h-8 text-right"
                                placeholder="—"
                                aria-label={`${v.name} rate`}
                              />
                            ) : rate != null ? (
                              fmt(rate)
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        );
                      })}
                      {awardable ? (
                        <td className="py-1">
                          <select
                            className={cn(field, "w-full")}
                            value={picks[line.id] ?? ""}
                            onChange={(e) => setPicks((p) => ({ ...p, [line.id]: e.target.value }))}
                            aria-label="Winning vendor"
                          >
                            <option value="">— pick winner —</option>
                            {quotedVendors.map((v) => (
                              <option key={v.vendor_id} value={v.vendor_id}>
                                {v.name}
                              </option>
                            ))}
                          </select>
                        </td>
                      ) : comparison.status === "awarded" ? (
                        <td className="py-1">
                          {line.award ? (
                            <span>
                              {comparison.vendors.find((v) => v.vendor_id === line.award!.vendor_id)?.name}
                              <span className="text-muted-foreground">
                                {" "}· {fmt(line.award.qty * line.award.rate)}
                              </span>
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
              {comparison.status === "awarded" && (
                <tfoot>
                  <tr className="border-t font-medium">
                    <td colSpan={2 + comparison.vendors.length} className="py-1 text-right">
                      Awarded total
                    </td>
                    <td className="py-1">{fmt(awardedTotal)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
