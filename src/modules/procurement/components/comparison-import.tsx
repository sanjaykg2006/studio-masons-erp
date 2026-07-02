"use client";

import { useRouter } from "next/navigation";
import { type ChangeEvent, useRef, useState, useTransition } from "react";
import { AlertTriangle, Check, Upload } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  ComparisonImportPreview,
  PackageRef,
} from "@/modules/procurement/types";
import {
  commitComparisonImport,
  previewComparisonImport,
} from "@/modules/procurement/import-actions";

const field = "border-input bg-background h-8 rounded-md border px-2 text-sm";

export function ComparisonImport({
  projectId,
  packages,
}: {
  projectId: string;
  packages: PackageRef[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ComparisonImportPreview | null>(null);
  const [targets, setTargets] = useState<Record<number, string>>({});
  const [done, setDone] = useState<Set<number>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  const autoTarget = (name: string) =>
    packages.find((p) => p.name.toLowerCase().trim() === name.toLowerCase().trim())?.id ?? "";

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (inputRef.current) inputRef.current.value = "";
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    startTransition(async () => {
      setError(null);
      setPreview(null);
      setDone(new Set());
      const res = await previewComparisonImport(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPreview(res.preview);
      setTargets(Object.fromEntries(res.preview.packages.map((p, i) => [i, autoTarget(p.name)])));
    });
  };

  const importOne = (i: number) => {
    if (!preview) return;
    const target = targets[i];
    startTransition(async () => {
      setError(null);
      const res = await commitComparisonImport(projectId, target, preview.packages[i], preview.vendorMatches);
      if (!res.ok) setError(res.error);
      else {
        setDone((d) => new Set(d).add(i));
        router.refresh();
      }
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-base">Import from Excel</CardTitle>
          <CardDescription>
            One sheet per package with a `BUDGET` block then one `Rate` block per vendor.
            Vendor names must match approved directory vendors.
          </CardDescription>
        </div>
        <input ref={inputRef} type="file" accept=".xlsx" className="hidden" onChange={onFile} aria-label="Comparison workbook" />
        <Button size="sm" variant="outline" disabled={pending || packages.length === 0} onClick={() => inputRef.current?.click()}>
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
              {preview.vendorMatches.length > 0 && (
                <div className="text-xs">
                  <span className="text-muted-foreground">Vendors: </span>
                  {preview.vendorMatches.map((m) => (
                    <span
                      key={m.name}
                      className={cn(
                        "mr-2 inline-flex items-center gap-1",
                        m.vendor_id ? "text-emerald-600" : "text-amber-700 dark:text-amber-400"
                      )}
                    >
                      {m.vendor_id ? <Check className="size-3" /> : <AlertTriangle className="size-3" />}
                      {m.name}
                    </span>
                  ))}
                </div>
              )}
              {preview.warnings.map((w, i) => (
                <p key={i} className="text-amber-700 dark:text-amber-400 flex items-start gap-1 text-xs">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {w}
                </p>
              ))}

              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-left text-xs">
                    <th className="py-1 font-medium">Sheet</th>
                    <th className="w-16 py-1 text-right font-medium">Lines</th>
                    <th className="py-1 font-medium">Maps to budget package</th>
                    <th className="w-24 py-1" />
                  </tr>
                </thead>
                <tbody>
                  {preview.packages.map((p, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-1">{p.name}</td>
                      <td className="py-1 text-right">{p.lines.length}</td>
                      <td className="py-1">
                        <select
                          className={cn(field, "w-full")}
                          value={targets[i] ?? ""}
                          onChange={(e) => setTargets((t) => ({ ...t, [i]: e.target.value }))}
                          disabled={done.has(i)}
                          aria-label={`Target package for ${p.name}`}
                        >
                          <option value="">— pick a package —</option>
                          {packages.map((bp) => (
                            <option key={bp.id} value={bp.id}>
                              {bp.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1 text-right">
                        {done.has(i) ? (
                          <span className="inline-flex items-center gap-1 text-emerald-600 text-xs">
                            <Check className="size-3" /> Imported
                          </span>
                        ) : (
                          <Button size="sm" variant="outline" disabled={pending || !targets[i]} onClick={() => importOne(i)}>
                            Import
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}
