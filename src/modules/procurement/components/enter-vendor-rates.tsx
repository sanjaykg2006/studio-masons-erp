"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ChangeEvent, useMemo, useRef, useState, useTransition } from "react";
import { ArrowLeft, Paperclip, X } from "lucide-react";

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
import { VENDOR_TYPE_LABEL, type OpenIntentLine, type Vendor } from "@/modules/procurement/types";
import { generateOrdersFromIntent } from "@/modules/procurement/order-actions";

const field = "border-input bg-background h-9 rounded-md border px-2 text-sm";
const fmt = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtQty = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

type PackageGroup = { id: string; name: string; lines: OpenIntentLine[] };

export function EnterVendorRates({
  projectId,
  intentId,
  projectName,
  approved,
  openLines,
  vendors,
}: {
  projectId: string;
  intentId: string;
  projectName: string;
  approved: boolean;
  openLines: OpenIntentLine[];
  vendors: Vendor[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Vendor chosen per package; rate typed per line; one supporting file per vendor.
  const [vendorByPkg, setVendorByPkg] = useState<Record<string, string>>({});
  const [rateByLine, setRateByLine] = useState<Record<string, number>>({});
  const [fileByVendor, setFileByVendor] = useState<Record<string, File>>({});

  const packages = useMemo<PackageGroup[]>(() => {
    const map = new Map<string, PackageGroup>();
    for (const l of openLines) {
      if (!map.has(l.package_id)) map.set(l.package_id, { id: l.package_id, name: l.package_name, lines: [] });
      map.get(l.package_id)!.lines.push(l);
    }
    return [...map.values()];
  }, [openLines]);

  const vendorName = (id: string) => vendors.find((v) => v.id === id)?.name ?? "Vendor";

  // A package is ready when it has a vendor and every line has a rate above zero.
  const isPkgReady = (pkg: PackageGroup) =>
    !!vendorByPkg[pkg.id] && pkg.lines.every((l) => (rateByLine[l.intent_line_id] ?? 0) > 0);
  const readyPackages = packages.filter(isPkgReady);
  const readyVendorIds = [...new Set(readyPackages.map((p) => vendorByPkg[p.id]))];
  const missingDoc = readyVendorIds.filter((v) => !fileByVendor[v]);
  const canGenerate = readyPackages.length > 0 && missingDoc.length === 0;

  const submit = () => {
    const lines = readyPackages.flatMap((pkg) =>
      pkg.lines.map((l) => ({
        intent_line_id: l.intent_line_id,
        vendor_id: vendorByPkg[pkg.id],
        rate: rateByLine[l.intent_line_id] ?? 0,
      }))
    );
    const fd = new FormData();
    fd.append("lines", JSON.stringify(lines));
    for (const v of readyVendorIds) fd.append(`doc_${v}`, fileByVendor[v]);

    startTransition(async () => {
      setError(null);
      const res = await generateOrdersFromIntent(projectId, intentId, fd);
      if (!res.ok) setError(res.error);
      else router.push(`/projects/${projectId}/orders`);
    });
  };

  return (
    <div className="space-y-6">
      <Link
        href={`/projects/${projectId}/intents`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" /> Purchase intents
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Enter vendor rates</h1>
        <p className="text-muted-foreground">
          {projectName} · Pick a vendor for each package and type its rate for every
          line. Attach a supporting document per vendor. Generating creates one
          purchase order per vendor.
        </p>
      </div>

      {error && (
        <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-md border px-4 py-2 text-sm">
          {error}
        </div>
      )}

      {!approved ? (
        <p className="text-muted-foreground text-sm">This intent hasn&apos;t been approved yet.</p>
      ) : packages.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Every line on this intent has already been ordered. There is nothing left to award.
        </p>
      ) : (
        <>
          {packages.map((pkg) => {
            const vendorId = vendorByPkg[pkg.id] ?? "";
            const vendor = vendors.find((v) => v.id === vendorId);
            return (
              <Card key={pkg.id}>
                <CardHeader>
                  <CardTitle className="text-base">{pkg.name}</CardTitle>
                  <CardDescription>
                    <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center">
                      <select
                        className={cn(field, "sm:w-72")}
                        value={vendorId}
                        onChange={(e) => setVendorByPkg((m) => ({ ...m, [pkg.id]: e.target.value }))}
                        aria-label={`Vendor for ${pkg.name}`}
                      >
                        <option value="">— pick a vendor —</option>
                        {vendors.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                          </option>
                        ))}
                      </select>
                      {vendor && (
                        <span className="text-muted-foreground text-xs">
                          {VENDOR_TYPE_LABEL[vendor.type]}
                          {vendor.trade ? ` · ${vendor.trade}` : ""}
                          {vendor.contact_name ? ` · ${vendor.contact_name}` : ""}
                          {vendor.contact_phone ? ` · ${vendor.contact_phone}` : ""}
                        </span>
                      )}
                    </div>
                  </CardDescription>
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
                          <th className="w-28 py-1 text-right font-medium">Vendor Rate</th>
                          <th className="w-28 py-1 text-right font-medium">Vendor Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pkg.lines.map((l) => {
                          const rate = rateByLine[l.intent_line_id] ?? 0;
                          const budgetAmt = l.open_qty * l.budget_rate;
                          const vendorAmt = l.open_qty * rate;
                          const over = rate > 0 && rate > l.budget_rate;
                          return (
                            <tr key={l.intent_line_id} className="border-b last:border-0">
                              <td className="py-1">
                                {l.ref ? `${l.ref} · ` : ""}
                                {l.description}
                              </td>
                              <td className="text-muted-foreground py-1">{l.location ?? "—"}</td>
                              <td className="text-muted-foreground py-1">{l.unit ?? ""}</td>
                              <td className="py-1 text-right">{fmtQty(l.open_qty)}</td>
                              <td className="py-1 text-right">{fmt(l.budget_rate)}</td>
                              <td className="py-1 text-right">{fmt(budgetAmt)}</td>
                              <td className="py-1">
                                <Input
                                  type="number"
                                  value={rate || ""}
                                  min={0}
                                  onChange={(e) =>
                                    setRateByLine((m) => ({
                                      ...m,
                                      [l.intent_line_id]: e.target.valueAsNumber || 0,
                                    }))
                                  }
                                  className="h-8 text-right"
                                  placeholder="0"
                                  aria-label={`Vendor rate ${l.description}`}
                                />
                              </td>
                              <td className={cn("py-1 text-right", over && "text-red-600 dark:text-red-400")}>
                                {fmt(vendorAmt)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            );
          })}

          {/* Supporting documents — one per vendor being ordered from ------------ */}
          {readyVendorIds.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Supporting documents</CardTitle>
                <CardDescription>
                  Required — attach the quote / comparison backup for each vendor.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {readyVendorIds.map((v) => (
                  <DocPicker
                    key={v}
                    label={vendorName(v)}
                    file={fileByVendor[v]}
                    onPick={(file) => setFileByVendor((m) => ({ ...m, [v]: file }))}
                    onClear={() =>
                      setFileByVendor((m) => {
                        const next = { ...m };
                        delete next[v];
                        return next;
                      })
                    }
                  />
                ))}
              </CardContent>
            </Card>
          )}

          <div className="flex items-center gap-3">
            <Button
              disabled={pending || !canGenerate}
              title={
                canGenerate
                  ? undefined
                  : "Pick a vendor and rates for at least one package, and attach each vendor's document"
              }
              onClick={submit}
            >
              Generate purchase orders
            </Button>
            {readyPackages.length > 0 && (
              <span className="text-muted-foreground text-sm">
                {readyVendorIds.length} purchase order{readyVendorIds.length === 1 ? "" : "s"} will be created.
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function DocPicker({
  label,
  file,
  onPick,
  onClear,
}: {
  label: string;
  file: File | undefined;
  onPick: (file: File) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) onPick(f);
    if (inputRef.current) inputRef.current.value = "";
  };
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="font-medium">{label}</span>
      <div className="flex items-center gap-2">
        {file ? (
          <span className="text-muted-foreground inline-flex max-w-[16rem] items-center gap-1 truncate">
            <Paperclip className="size-3.5 shrink-0" />
            <span className="truncate">{file.name}</span>
            <button type="button" onClick={onClear} className="hover:text-destructive" aria-label="Remove file">
              <X className="size-3.5" />
            </button>
          </span>
        ) : (
          <span className="text-destructive text-xs">No document</span>
        )}
        <input ref={inputRef} type="file" className="hidden" onChange={onChange} aria-label={`Upload ${label} document`} />
        <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()}>
          <Paperclip className="size-4" /> {file ? "Replace" : "Attach"}
        </Button>
      </div>
    </div>
  );
}
