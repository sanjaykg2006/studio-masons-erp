"use client";

import { useRouter } from "next/navigation";
import { type ChangeEvent, useRef, useState, useTransition } from "react";
import { AlertTriangle, Check, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { BudgetImportReconcile, BudgetImportPreview } from "@/modules/procurement/types";
import { commitBudgetImport, previewBudgetImport } from "@/modules/procurement/import-actions";

const fmt = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The per-sheet self-check: ✓ matches the sheet's own total, ⚠ differs (shows
 * that total so the QS can eyeball it), — no total row on the sheet to check. */
function Reconcile({ r }: { r: BudgetImportReconcile }) {
  if (r.status === "ok")
    return (
      <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400" title="Matches the sheet's own total">
        <Check className="size-3.5" /> Matches
      </span>
    );
  if (r.status === "warn")
    return (
      <span
        className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400"
        title={`Sheet's own total is ${fmt(r.sheetTotal)}`}
      >
        <AlertTriangle className="size-3.5" /> Sheet: {fmt(r.sheetTotal)}
      </span>
    );
  return <span className="text-muted-foreground" title="No total row on the sheet to check against">—</span>;
}

export function BudgetImport({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<BudgetImportPreview | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (inputRef.current) inputRef.current.value = "";
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    startTransition(async () => {
      setError(null);
      setPreview(null);
      const res = await previewBudgetImport(fd);
      if (!res.ok) setError(res.error);
      else setPreview(res.preview);
    });
  };

  const confirm = () => {
    if (!preview) return;
    startTransition(async () => {
      setError(null);
      const res = await commitBudgetImport(projectId, preview.packages);
      if (!res.ok) setError(res.error);
      else {
        setPreview(null);
        router.refresh();
      }
    });
  };

  const grand = preview?.packages.reduce((s, p) => s + p.total, 0) ?? 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-base">Import from Excel</CardTitle>
          <CardDescription>
            One sheet per package (Description · Unit · Qty · Rate · Amount; split
            Supply/Installation rates are clubbed). Each sheet is checked against its
            own total. Creates a new draft version to review before releasing.
          </CardDescription>
        </div>
        <input ref={inputRef} type="file" accept=".xlsx" className="hidden" onChange={onFile} aria-label="Budget workbook" />
        <Button size="sm" variant="outline" disabled={pending} onClick={() => inputRef.current?.click()}>
          <Upload className="size-4" /> Choose file
        </Button>
      </CardHeader>

      {(error || preview) && (
        <CardContent className="space-y-3">
          {error && (
            <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-md border px-4 py-2 text-sm">
              {error}
            </div>
          )}
          {preview && (
            <>
              {preview.warnings.map((w, i) => (
                <p key={i} className="text-amber-700 dark:text-amber-400 flex items-start gap-1 text-xs">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {w}
                </p>
              ))}
              {preview.packages.length > 0 && (
                <>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-muted-foreground border-b text-left text-xs">
                        <th className="py-1 font-medium">Package</th>
                        <th className="w-20 py-1 text-right font-medium">Lines</th>
                        <th className="w-32 py-1 text-right font-medium">Total</th>
                        <th className="w-28 py-1 text-right font-medium">Check</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.packages.map((p, i) => (
                        <tr key={i} className="border-b last:border-0">
                          <td className="py-1">{p.name}</td>
                          <td className="py-1 text-right">{p.lines.length}</td>
                          <td className="py-1 text-right">{fmt(p.total)}</td>
                          <td className="py-1 text-right">
                            <Reconcile r={p.reconcile} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t font-medium">
                        <td className="py-1">Grand total</td>
                        <td />
                        <td className="py-1 text-right">{fmt(grand)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                  <div className="flex gap-2">
                    <Button size="sm" disabled={pending} onClick={confirm}>
                      Import {preview.packages.length} package{preview.packages.length === 1 ? "" : "s"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setPreview(null)}>
                      Cancel
                    </Button>
                  </div>
                </>
              )}
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}
