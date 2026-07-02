"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";

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
  COMPARISON_STATUS_LABEL,
  VENDOR_TYPE_LABEL,
  type ComparisonStatus,
  type ComparisonSummary,
  type PackageRef,
  type ProjectVendor,
  type Vendor,
} from "@/modules/procurement/types";
import { createComparison, setProjectVendor } from "@/modules/procurement/comparison-actions";

type Result = { ok: true } | { ok: false; error: string };

const STATUS_TONE: Record<ComparisonStatus, string> = {
  draft: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  awarded: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
};

const field = "border-input bg-background h-9 rounded-md border px-2 text-sm";

export function ComparisonsList({
  projectId,
  projectName,
  comparisons,
  packages,
  projectVendors,
  approvedVendors,
  canCreate,
  canAward,
}: {
  projectId: string;
  projectName: string;
  comparisons: ComparisonSummary[];
  packages: PackageRef[];
  projectVendors: ProjectVendor[];
  approvedVendors: Vendor[];
  canCreate: boolean;
  canAward: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [pkg, setPkg] = useState("");
  const [addVendor, setAddVendor] = useState("");

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

  const submitNew = (e: FormEvent) => {
    e.preventDefault();
    if (!pkg) return;
    startTransition(async () => {
      setError(null);
      const res = await createComparison(projectId, pkg, title);
      if (!res.ok) setError(res.error);
      else router.push(`/projects/${projectId}/comparisons/${res.id}`);
    });
  };

  const inList = new Set(projectVendors.map((v) => v.vendor_id));
  const addable = approvedVendors.filter((v) => !inList.has(v.id));

  return (
    <div className="space-y-6">
      <Link
        href={`/projects/${projectId}`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" /> {projectName}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Comparisons</h1>
          <p className="text-muted-foreground">
            Weigh vendor quotes for a budget package, then award each line to a
            winner. Winners join the project&apos;s approved-vendor list.
          </p>
        </div>
        {canCreate && packages.length > 0 && (
          <Button size="sm" onClick={() => setOpen((o) => !o)}>
            <Plus className="size-4" /> New comparison
          </Button>
        )}
      </div>

      {error && (
        <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-md border px-4 py-2 text-sm">
          {error}
        </div>
      )}

      {canCreate && packages.length === 0 && (
        <p className="text-muted-foreground text-sm">
          Release a Budget BOQ with packages first — a comparison starts from one.
        </p>
      )}

      {open && canCreate && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New comparison</CardTitle>
            <CardDescription>Its lines copy from the chosen package.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submitNew} className="flex flex-col gap-2 sm:flex-row">
              <select
                className={cn(field, "sm:w-56")}
                value={pkg}
                onChange={(e) => setPkg(e.target.value)}
                aria-label="Package"
              >
                <option value="">— pick a package —</option>
                {packages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <Input
                placeholder="Title (optional)"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="sm:flex-1"
                aria-label="Title"
              />
              <Button type="submit" size="sm" disabled={pending}>
                Create
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          {comparisons.length === 0 ? (
            <p className="text-muted-foreground text-sm">No comparisons yet.</p>
          ) : (
            <ul className="space-y-2">
              {comparisons.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/projects/${projectId}/comparisons/${c.id}`}
                    className="hover:bg-muted/50 flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {c.title || c.package_name || "Comparison"}
                        </span>
                        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", STATUS_TONE[c.status])}>
                          {COMPARISON_STATUS_LABEL[c.status]}
                        </span>
                      </div>
                      <div className="text-muted-foreground text-xs">
                        {c.line_count} line{c.line_count === 1 ? "" : "s"} · {c.vendor_count} vendor
                        {c.vendor_count === 1 ? "" : "s"}
                        {c.awarded_by_name && ` · awarded by ${c.awarded_by_name}`}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Approved-vendor list ------------------------------------------------ */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Approved vendors for this project</CardTitle>
          <CardDescription>
            Comparison winners are added automatically; you can also add or remove
            vendors here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {projectVendors.length === 0 ? (
            <p className="text-muted-foreground text-sm">No approved vendors yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {projectVendors.map((v) => (
                <li key={v.vendor_id} className="flex items-center justify-between py-1.5">
                  <span>
                    {v.name}{" "}
                    <span className="text-muted-foreground text-xs">
                      · {VENDOR_TYPE_LABEL[v.type]}
                    </span>
                  </span>
                  {canAward && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => run(() => setProjectVendor(projectId, v.vendor_id, false))}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={`Remove ${v.name}`}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canAward && addable.length > 0 && (
            <div className="flex gap-2">
              <select
                className={cn(field, "flex-1")}
                value={addVendor}
                onChange={(e) => setAddVendor(e.target.value)}
                aria-label="Add an approved vendor"
              >
                <option value="">— add a vendor —</option>
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
                  run(() => setProjectVendor(projectId, addVendor, true), () => setAddVendor(""))
                }
              >
                Add
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
