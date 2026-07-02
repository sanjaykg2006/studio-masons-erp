"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";
import { ArrowLeft, Check, Pencil, Plus, Trash2, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  BUDGET_STATUS_LABEL,
  type BudgetLine,
  type BudgetLineInput,
  type BudgetPackage,
  type ProjectBudget,
} from "@/modules/procurement/types";
import {
  addLine,
  addPackage,
  deleteLine,
  deletePackage,
  newBudgetVersion,
  releaseBudget,
  renamePackage,
  startBudget,
  updateLine,
} from "@/modules/procurement/budget-actions";

type Result = { ok: true } | { ok: false; error: string };

const fmt = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const field = "border-input bg-background h-8 rounded-md border px-2 text-sm";
const EMPTY_LINE: BudgetLineInput = { ref: "", description: "", unit: "", qty: 0, rate: 0 };

export function BudgetBoq({
  projectId,
  projectName,
  budget,
  canCreate,
  canEdit,
  canApprove,
}: {
  projectId: string;
  projectName: string;
  budget: ProjectBudget;
  canCreate: boolean;
  canEdit: boolean;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const { versions, current } = budget;
  // Editing is only possible on a DRAFT version, by someone with the edit verb.
  const editable = canEdit && current?.status === "draft";
  const isLatest = current && versions[0]?.id === current.id;

  const run = (fn: () => Promise<Result>) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error);
      else router.refresh();
    });

  const grandTotal =
    current?.packages.reduce(
      (sum, p) => sum + p.lines.reduce((s, l) => s + l.amount, 0),
      0
    ) ?? 0;

  return (
    <div className="space-y-6">
      <Link
        href={`/projects/${projectId}`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" /> {projectName}
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Budget BOQ</h1>
          <p className="text-muted-foreground">
            The project&apos;s budgeted quantities and rates. Ordered quantities are
            later capped against these, per line.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {current && versions.length > 1 && (
            <select
              className={cn(field, "h-9")}
              value={current.id}
              onChange={(e) => router.push(`/projects/${projectId}/budget?v=${e.target.value}`)}
              aria-label="Budget version"
            >
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.version_no} · {BUDGET_STATUS_LABEL[v.status]}
                </option>
              ))}
            </select>
          )}
          {current && (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs font-medium",
                current.status === "released"
                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                  : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
              )}
            >
              v{current.version_no} · {BUDGET_STATUS_LABEL[current.status]}
            </span>
          )}
          {editable && (
            <Button
              size="sm"
              disabled={pending}
              onClick={() => run(() => releaseBudget(projectId, current!.id))}
            >
              Release
            </Button>
          )}
          {current?.status === "released" && isLatest && canApprove && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => run(() => newBudgetVersion(projectId))}
            >
              New version
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-md border px-4 py-2 text-sm">
          {error}
        </div>
      )}

      {!current ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3 pt-6">
            <p className="text-muted-foreground text-sm">
              This project has no budget yet.
            </p>
            {canCreate && (
              <Button size="sm" disabled={pending} onClick={() => run(() => startBudget(projectId))}>
                <Plus className="size-4" /> Start budget
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          {current.status === "released" && (
            <p className="text-muted-foreground text-sm">
              This version is released and read-only.
              {isLatest && canApprove && " Use “New version” to revise it."}
            </p>
          )}

          {current.packages.length === 0 && !editable && (
            <p className="text-muted-foreground text-sm">No packages in this version.</p>
          )}

          <div className="space-y-4">
            {current.packages.map((pkg) => (
              <PackageBlock
                key={pkg.id}
                projectId={projectId}
                pkg={pkg}
                editable={!!editable}
                pending={pending}
                run={run}
              />
            ))}
          </div>

          {editable && (
            <AddPackageForm
              pending={pending}
              onAdd={(name) => run(() => addPackage(projectId, current.id, name))}
            />
          )}

          {current.packages.length > 0 && (
            <div className="flex justify-end border-t pt-3 text-sm font-semibold">
              Total: {fmt(grandTotal)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PackageBlock({
  projectId,
  pkg,
  editable,
  pending,
  run,
}: {
  projectId: string;
  pkg: BudgetPackage;
  editable: boolean;
  pending: boolean;
  run: (fn: () => Promise<Result>) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(pkg.name);
  const total = pkg.lines.reduce((s, l) => s + l.amount, 0);

  return (
    <Card>
      <CardContent className="pt-5">
        <div className="mb-2 flex items-center justify-between gap-2">
          {renaming ? (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                run(() => renamePackage(projectId, pkg.id, name));
                setRenaming(false);
              }}
            >
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-8"
                aria-label="Package name"
              />
              <Button type="submit" size="sm" disabled={pending}>
                Save
              </Button>
            </form>
          ) : (
            <h2 className="font-semibold">{pkg.name}</h2>
          )}
          {editable && !renaming && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setRenaming(true)}
                className="text-muted-foreground hover:text-foreground"
                aria-label={`Rename ${pkg.name}`}
              >
                <Pencil className="size-4" />
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (confirm(`Delete package "${pkg.name}" and its lines?`))
                    run(() => deletePackage(projectId, pkg.id));
                }}
                className="text-muted-foreground hover:text-destructive"
                aria-label={`Delete ${pkg.name}`}
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          )}
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted-foreground border-b text-left text-xs">
              <th className="w-16 py-1 font-medium">Ref</th>
              <th className="py-1 font-medium">Description</th>
              <th className="w-16 py-1 font-medium">Unit</th>
              <th className="w-20 py-1 text-right font-medium">Qty</th>
              <th className="w-24 py-1 text-right font-medium">Rate</th>
              <th className="w-28 py-1 text-right font-medium">Amount</th>
              {editable && <th className="w-16 py-1" />}
            </tr>
          </thead>
          <tbody>
            {pkg.lines.map((line) => (
              <LineRow
                key={line.id}
                projectId={projectId}
                line={line}
                editable={editable}
                pending={pending}
                run={run}
              />
            ))}
            {editable && (
              <AddLineRow
                projectId={projectId}
                packageId={pkg.id}
                pending={pending}
                run={run}
              />
            )}
          </tbody>
          <tfoot>
            <tr className="border-t font-medium">
              <td colSpan={5} className="py-1 text-right">
                Package total
              </td>
              <td className="py-1 text-right">{fmt(total)}</td>
              {editable && <td />}
            </tr>
          </tfoot>
        </table>
      </CardContent>
    </Card>
  );
}

function LineRow({
  projectId,
  line,
  editable,
  pending,
  run,
}: {
  projectId: string;
  line: BudgetLine;
  editable: boolean;
  pending: boolean;
  run: (fn: () => Promise<Result>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<BudgetLineInput>({
    ref: line.ref ?? "",
    description: line.description,
    unit: line.unit ?? "",
    qty: line.qty,
    rate: line.rate,
  });
  const set = (patch: Partial<BudgetLineInput>) => setForm((f) => ({ ...f, ...patch }));

  if (editing) {
    return (
      <tr className="border-b last:border-0">
        <td className="py-1 pr-1">
          <Input value={form.ref} onChange={(e) => set({ ref: e.target.value })} className="h-8" aria-label="Ref" />
        </td>
        <td className="py-1 pr-1">
          <Input value={form.description} onChange={(e) => set({ description: e.target.value })} className="h-8" aria-label="Description" />
        </td>
        <td className="py-1 pr-1">
          <Input value={form.unit} onChange={(e) => set({ unit: e.target.value })} className="h-8" aria-label="Unit" />
        </td>
        <td className="py-1 pr-1">
          <Input type="number" value={form.qty} onChange={(e) => set({ qty: e.target.valueAsNumber || 0 })} className="h-8 text-right" aria-label="Qty" />
        </td>
        <td className="py-1 pr-1">
          <Input type="number" value={form.rate} onChange={(e) => set({ rate: e.target.valueAsNumber || 0 })} className="h-8 text-right" aria-label="Rate" />
        </td>
        <td className="py-1 text-right text-muted-foreground">{fmt(form.qty * form.rate)}</td>
        <td className="py-1">
          <div className="flex justify-end gap-1">
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                run(() => updateLine(projectId, line.id, form));
                setEditing(false);
              }}
              className="text-muted-foreground hover:text-emerald-600"
              aria-label="Save line"
            >
              <Check className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Cancel"
            >
              <X className="size-4" />
            </button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b last:border-0">
      <td className="text-muted-foreground py-1">{line.ref ?? "—"}</td>
      <td className="py-1">{line.description}</td>
      <td className="text-muted-foreground py-1">{line.unit ?? "—"}</td>
      <td className="py-1 text-right">{fmt(line.qty)}</td>
      <td className="py-1 text-right">{fmt(line.rate)}</td>
      <td className="py-1 text-right">{fmt(line.amount)}</td>
      {editable && (
        <td className="py-1">
          <div className="flex justify-end gap-1">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Edit line"
            >
              <Pencil className="size-4" />
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => deleteLine(projectId, line.id))}
              className="text-muted-foreground hover:text-destructive"
              aria-label="Delete line"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        </td>
      )}
    </tr>
  );
}

function AddLineRow({
  projectId,
  packageId,
  pending,
  run,
}: {
  projectId: string;
  packageId: string;
  pending: boolean;
  run: (fn: () => Promise<Result>) => void;
}) {
  const [form, setForm] = useState<BudgetLineInput>(EMPTY_LINE);
  const set = (patch: Partial<BudgetLineInput>) => setForm((f) => ({ ...f, ...patch }));

  const submit = () => {
    if (!form.description.trim()) return;
    run(() => addLine(projectId, packageId, form));
    setForm(EMPTY_LINE);
  };

  return (
    <tr>
      <td className="py-1 pr-1">
        <Input value={form.ref} onChange={(e) => set({ ref: e.target.value })} className="h-8" placeholder="Ref" aria-label="New line ref" />
      </td>
      <td className="py-1 pr-1">
        <Input value={form.description} onChange={(e) => set({ description: e.target.value })} className="h-8" placeholder="Add a line…" aria-label="New line description" />
      </td>
      <td className="py-1 pr-1">
        <Input value={form.unit} onChange={(e) => set({ unit: e.target.value })} className="h-8" placeholder="Unit" aria-label="New line unit" />
      </td>
      <td className="py-1 pr-1">
        <Input type="number" value={form.qty || ""} onChange={(e) => set({ qty: e.target.valueAsNumber || 0 })} className="h-8 text-right" placeholder="0" aria-label="New line qty" />
      </td>
      <td className="py-1 pr-1">
        <Input type="number" value={form.rate || ""} onChange={(e) => set({ rate: e.target.valueAsNumber || 0 })} className="h-8 text-right" placeholder="0" aria-label="New line rate" />
      </td>
      <td className="py-1 text-right text-muted-foreground">{fmt(form.qty * form.rate)}</td>
      <td className="py-1">
        <div className="flex justify-end">
          <button
            type="button"
            disabled={pending}
            onClick={submit}
            className="text-muted-foreground hover:text-emerald-600"
            aria-label="Add line"
          >
            <Plus className="size-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}

function AddPackageForm({
  pending,
  onAdd,
}: {
  pending: boolean;
  onAdd: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onAdd(name);
    setName("");
  };
  return (
    <form onSubmit={submit} className="flex gap-2">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="New package name"
        className="sm:w-72"
        aria-label="New package name"
      />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        <Plus className="size-4" /> Add package
      </Button>
    </form>
  );
}
