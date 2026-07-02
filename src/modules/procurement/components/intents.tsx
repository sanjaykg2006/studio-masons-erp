"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";
import { ArrowLeft, Check, Plus, Trash2, X } from "lucide-react";

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
  INTENT_STATUS_LABEL,
  type Intent,
  type IntentLine,
  type IntentLineDraft,
  type IntentStatus,
  type ReleasedBudgetLine,
} from "@/modules/procurement/types";
import {
  approveIntent,
  loadIntentLines,
  raiseIntent,
  rejectIntent,
  withdrawIntent,
} from "@/modules/procurement/intent-actions";

type Result = { ok: true } | { ok: false; error: string };

const STATUS_TONE: Record<IntentStatus, string> = {
  pending: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  approved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  rejected: "bg-muted text-muted-foreground",
};

const field = "border-input bg-background h-9 rounded-md border px-2 text-sm";
const fmt = (n: number) =>
  n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

export function Intents({
  projectId,
  projectName,
  intents,
  releasedLines,
  canCreate,
}: {
  projectId: string;
  projectName: string;
  intents: Intent[];
  releasedLines: ReleasedBudgetLine[];
  canCreate: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [lines, setLines] = useState<Record<string, IntentLine[]>>({});

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

  const toggle = async (id: string) => {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setExpanded(id);
    if (!lines[id]) {
      const res = await loadIntentLines(id);
      if (res.ok) setLines((m) => ({ ...m, [id]: res.lines }));
      else setError(res.error);
    }
  };

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
          <h1 className="text-2xl font-semibold tracking-tight">Purchase intents</h1>
          <p className="text-muted-foreground">
            A request to buy against the released Budget BOQ. Over-budget quantities
            are flagged and need the Director&apos;s approval to clear. Approving a line
            that already has a purchase order folds into that PO as an amendment.
          </p>
        </div>
        {canCreate && (
          <Button size="sm" onClick={() => setOpen((o) => !o)}>
            <Plus className="size-4" /> Raise intent
          </Button>
        )}
      </div>

      {error && (
        <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-md border px-4 py-2 text-sm">
          {error}
        </div>
      )}

      {open && canCreate && (
        <RaiseIntentForm
          releasedLines={releasedLines}
          pending={pending}
          onCancel={() => setOpen(false)}
          onSubmit={(neededBy, notes, draft) =>
            run(() => raiseIntent(projectId, neededBy, notes, draft), () => setOpen(false))
          }
        />
      )}

      {intents.length === 0 ? (
        <p className="text-muted-foreground text-sm">No intents yet.</p>
      ) : (
        <ul className="space-y-2">
          {intents.map((it) => (
            <li key={it.id} className="rounded-md border">
              <div className="flex items-center justify-between gap-3 px-3 py-2">
                <button
                  type="button"
                  onClick={() => toggle(it.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {it.line_count} line{it.line_count === 1 ? "" : "s"} · {fmt(it.total_qty)} qty
                    </span>
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", STATUS_TONE[it.status])}>
                      {INTENT_STATUS_LABEL[it.status]}
                    </span>
                    {it.over_budget_any && (
                      <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-medium text-red-700 dark:text-red-400">
                        Over budget
                      </span>
                    )}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {it.raiser_name ?? "Someone"}
                    {it.needed_by && ` · needed by ${it.needed_by}`}
                    {it.approver_name && ` · ${it.status} by ${it.approver_name}`}
                  </div>
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  {it.status === "pending" && it.can_approve && (
                    <>
                      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => approveIntent(projectId, it.id))}>
                        <Check className="size-4" /> Approve
                      </Button>
                      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => rejectIntent(projectId, it.id))}>
                        <X className="size-4" /> Reject
                      </Button>
                    </>
                  )}
                  {it.can_withdraw && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        if (confirm("Withdraw this intent?")) run(() => withdrawIntent(projectId, it.id));
                      }}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Withdraw intent"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </div>
              </div>

              {expanded === it.id && (
                <div className="border-t px-3 py-2">
                  {it.notes && <p className="text-muted-foreground mb-2 text-xs italic">{it.notes}</p>}
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-muted-foreground border-b text-left text-xs">
                        <th className="py-1 font-medium">Package</th>
                        <th className="py-1 font-medium">Line</th>
                        <th className="w-24 py-1 text-right font-medium">Budgeted</th>
                        <th className="w-24 py-1 text-right font-medium">Requested</th>
                        <th className="w-28 py-1 font-medium" />
                      </tr>
                    </thead>
                    <tbody>
                      {(lines[it.id] ?? []).map((l) => (
                        <tr key={l.id} className="border-b last:border-0">
                          <td className="text-muted-foreground py-1">{l.package_name}</td>
                          <td className="py-1">
                            {l.ref ? `${l.ref} · ` : ""}
                            {l.description}
                          </td>
                          <td className="py-1 text-right">{fmt(l.budgeted_qty)} {l.unit ?? ""}</td>
                          <td className="py-1 text-right">{fmt(l.qty_requested)}</td>
                          <td className="py-1">
                            {l.over_budget && (
                              <span className="text-red-600 dark:text-red-400 text-xs">
                                Over budget{l.bypass_by_name ? ` · cleared by ${l.bypass_by_name}` : ""}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RaiseIntentForm({
  releasedLines,
  pending,
  onSubmit,
  onCancel,
}: {
  releasedLines: ReleasedBudgetLine[];
  pending: boolean;
  onSubmit: (neededBy: string, notes: string, lines: IntentLineDraft[]) => void;
  onCancel: () => void;
}) {
  const [neededBy, setNeededBy] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<IntentLineDraft[]>([{ budget_line_id: "", qty: 0 }]);

  const setRow = (i: number, patch: Partial<IntentLineDraft>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, { budget_line_id: "", qty: 0 }]);
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, idx) => idx !== i));

  const lineById = (id: string) => releasedLines.find((l) => l.budget_line_id === id);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(neededBy, notes, rows);
  };

  if (releasedLines.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-muted-foreground text-sm">
            There&apos;s no released budget to buy against yet. Release a Budget BOQ
            version first, then raise an intent.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">New purchase intent</CardTitle>
        <CardDescription>Pick budget lines and the quantities you need.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="text-muted-foreground flex items-center gap-2 text-sm">
              Needed by
              <input
                type="date"
                value={neededBy}
                onChange={(e) => setNeededBy(e.target.value)}
                className={field}
                aria-label="Needed by"
              />
            </label>
            <Input
              placeholder="Notes (optional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="sm:flex-1"
              aria-label="Notes"
            />
          </div>

          <div className="space-y-2">
            {rows.map((row, i) => {
              const picked = lineById(row.budget_line_id);
              const remaining = picked ? picked.budgeted_qty - picked.committed_qty : 0;
              const over = !!picked && row.qty > 0 && row.qty > remaining;
              return (
                <div key={i} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <select
                    className={cn(field, "sm:flex-1")}
                    value={row.budget_line_id}
                    onChange={(e) => setRow(i, { budget_line_id: e.target.value })}
                    aria-label="Budget line"
                  >
                    <option value="">— pick a budget line —</option>
                    {releasedLines.map((l) => (
                      <option key={l.budget_line_id} value={l.budget_line_id}>
                        {l.package_name} · {l.ref ? `${l.ref} ` : ""}
                        {l.description} (left {fmt(l.budgeted_qty - l.committed_qty)} {l.unit ?? ""})
                      </option>
                    ))}
                  </select>
                  <Input
                    type="number"
                    placeholder="Qty"
                    value={row.qty || ""}
                    onChange={(e) => setRow(i, { qty: e.target.valueAsNumber || 0 })}
                    className="sm:w-28"
                    aria-label="Quantity"
                  />
                  {over && (
                    <span className="text-xs text-red-600 dark:text-red-400">Over budget</span>
                  )}
                  {rows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeRow(i)}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Remove line"
                    >
                      <X className="size-4" />
                    </button>
                  )}
                </div>
              );
            })}
            <Button type="button" size="sm" variant="outline" onClick={addRow}>
              <Plus className="size-4" /> Add line
            </Button>
          </div>

          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              Raise intent
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
