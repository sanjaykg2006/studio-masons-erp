"use client";

import { useRouter } from "next/navigation";
import { Fragment, type FormEvent, useState, useTransition } from "react";
import { Check, Download, FileText, Plus, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  KIND_LABEL,
  PETTYCASH_STATUS_LABEL,
  inr,
  type PettyCashCategory,
  type PettyCashEntry,
  type PettyCashStatus,
  type ProjectOption,
} from "@/modules/pettycash/types";
import {
  billingApprovePettyCash,
  createPettyCash,
  deletePettyCash,
  getVoucherUrl,
  mdApprovePettyCash,
  payPettyCash,
  rejectPettyCash,
  savePettyCashCategory,
  setPettyCashCategoryActive,
} from "@/modules/pettycash/actions";

type Result = { ok: true } | { ok: false; error: string };
const field = "border-input bg-background h-9 rounded-md border px-2 text-sm";

const STATUS_TONE: Record<PettyCashStatus, string> = {
  pending_billing: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  pending_md: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
  pending_accounts: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  paid: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  rejected: "bg-destructive/10 text-destructive",
};

export function PettyCashView({
  entries,
  categories,
  projects,
  canManageCategories,
}: {
  entries: PettyCashEntry[];
  categories: PettyCashCategory[];
  projects: ProjectOption[];
  canManageCategories: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [managing, setManaging] = useState(false);

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

  const openVoucher = (id: string) =>
    startTransition(async () => {
      const res = await getVoucherUrl(id);
      if (res.ok) window.open(res.url, "_blank", "noopener,noreferrer");
      else setError(res.error);
    });

  const reject = (e: PettyCashEntry) => {
    const reason = prompt(`Reject this ${inr(e.amount)} entry — reason?`);
    if (reason === null) return;
    run(() => rejectPettyCash(e.id, reason));
  };

  const remove = (e: PettyCashEntry) => {
    if (!confirm("Remove this petty-cash entry?")) return;
    run(() => deletePettyCash(e.id));
  };

  const exportMine = () => {
    const mine = entries.filter((e) => e.mine);
    const headers = ["Date", "Category", "Type", "Project", "Amount", "Status", "Description"];
    const rows = mine.map((e) => [
      e.spent_on, e.category_name ?? "", KIND_LABEL[e.kind], e.project_name ?? "Company",
      e.amount, PETTYCASH_STATUS_LABEL[e.status], e.description ?? "",
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "my-petty-cash.csv";
    a.click();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Petty Cash</h1>
          <p className="text-muted-foreground">
            Log a small spend and claim it. Billing → MD → Accounts approve and pay.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={exportMine}>
            <Download className="size-4" /> Export mine
          </Button>
          {canManageCategories && (
            <Button size="sm" variant="outline" onClick={() => setManaging((m) => !m)}>
              Categories
            </Button>
          )}
          <Button size="sm" onClick={() => setAdding((a) => !a)}>
            <Plus className="size-4" /> Log spend
          </Button>
        </div>
      </div>

      {error && (
        <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-md border px-4 py-2 text-sm">
          {error}
        </div>
      )}

      {managing && canManageCategories && (
        <CategoryManager categories={categories} pending={pending} run={run} />
      )}

      {adding && (
        <LogForm
          categories={categories.filter((c) => c.active)}
          projects={projects}
          pending={pending}
          onError={setError}
          onCancel={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            router.refresh();
          }}
        />
      )}

      <Card>
        <CardContent className="pt-6">
          {entries.length === 0 ? (
            <p className="text-muted-foreground text-sm">No petty-cash entries yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-left">
                    <th className="py-2 font-medium">Date</th>
                    <th className="py-2 font-medium">Who / Category</th>
                    <th className="py-2 font-medium">Project</th>
                    <th className="py-2 font-medium">Amount</th>
                    <th className="py-2 font-medium">Status</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <Fragment key={e.id}>
                      <tr className="border-b last:border-0">
                        <td className="text-muted-foreground py-2">{e.spent_on}</td>
                        <td className="py-2">
                          <div className="font-medium">{e.category_name ?? "—"}</div>
                          <div className="text-muted-foreground text-xs">
                            {e.mine ? "You" : e.created_name ?? "—"} · {KIND_LABEL[e.kind]}
                          </div>
                        </td>
                        <td className="text-muted-foreground py-2">{e.project_name ?? "Company"}</td>
                        <td className="py-2">{inr(e.amount)}</td>
                        <td className="py-2">
                          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", STATUS_TONE[e.status])}>
                            {PETTYCASH_STATUS_LABEL[e.status]}
                          </span>
                          {e.status === "rejected" && e.reject_reason && (
                            <div className="text-muted-foreground text-[10px]">{e.reject_reason}</div>
                          )}
                        </td>
                        <td className="py-2">
                          <div className="flex items-center justify-end gap-1">
                            {e.file_path && (
                              <button
                                type="button"
                                disabled={pending}
                                onClick={() => openVoucher(e.id)}
                                className="text-muted-foreground hover:text-foreground"
                                title="Open voucher"
                                aria-label="Open voucher"
                              >
                                <FileText className="size-4" />
                              </button>
                            )}
                            {e.status === "pending_billing" && e.can_billing && (
                              <Button size="sm" disabled={pending} onClick={() => run(() => billingApprovePettyCash(e.id))}>
                                <Check className="size-4" /> Billing
                              </Button>
                            )}
                            {e.status === "pending_md" && e.can_md && (
                              <Button size="sm" disabled={pending} onClick={() => run(() => mdApprovePettyCash(e.id))}>
                                <Check className="size-4" /> MD
                              </Button>
                            )}
                            {e.status === "pending_accounts" && e.can_pay && (
                              <Button size="sm" disabled={pending} onClick={() => run(() => payPettyCash(e.id))}>
                                Pay
                              </Button>
                            )}
                            {e.can_reject && e.status !== "paid" && e.status !== "rejected" && (
                              <Button size="sm" variant="outline" disabled={pending} onClick={() => reject(e)}>
                                Reject
                              </Button>
                            )}
                            {e.mine && e.status === "pending_billing" && (
                              <button
                                type="button"
                                disabled={pending}
                                onClick={() => remove(e)}
                                className="text-muted-foreground hover:text-destructive"
                                title="Remove"
                                aria-label="Remove entry"
                              >
                                <Trash2 className="size-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function LogForm({
  categories,
  projects,
  pending,
  onError,
  onCancel,
  onDone,
}: {
  categories: PettyCashCategory[];
  projects: ProjectOption[];
  pending: boolean;
  onError: (e: string) => void;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [kind, setKind] = useState("reimbursement");
  const [projectId, setProjectId] = useState("");
  const [spentOn, setSpentOn] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, startSubmit] = useTransition();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!(parseFloat(amount || "0") > 0)) return onError("Enter an amount.");
    const fd = new FormData();
    fd.set("amount", amount);
    fd.set("category_id", categoryId);
    fd.set("kind", kind);
    fd.set("project_id", projectId);
    fd.set("spent_on", spentOn);
    fd.set("description", description);
    if (file) fd.set("file", file);
    startSubmit(async () => {
      const res = await createPettyCash(fd);
      if (!res.ok) onError(res.error);
      else onDone();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Log a spend</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input inputMode="decimal" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} className="sm:w-32" aria-label="Amount" />
            <select className={cn(field, "sm:flex-1")} value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Category">
              <option value="">Category…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <select className={cn(field, "sm:w-40")} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Type">
              <option value="reimbursement">Reimbursement</option>
              <option value="float">Cash float</option>
            </select>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <select className={cn(field, "sm:flex-1")} value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Project">
              <option value="">Company (no project)</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <input type="date" className={field} value={spentOn} onChange={(e) => setSpentOn(e.target.value)} aria-label="Date spent" />
          </div>
          <Input placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} aria-label="Description" />
          <div className="flex flex-wrap items-center gap-2">
            <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-muted-foreground text-xs" aria-label="Voucher" />
            <Button type="submit" size="sm" disabled={pending || submitting}>Submit</Button>
            <Button type="button" size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function CategoryManager({
  categories,
  pending,
  run,
}: {
  categories: PettyCashCategory[];
  pending: boolean;
  run: (fn: () => Promise<Result>, after?: () => void) => void;
}) {
  const [name, setName] = useState("");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Petty-cash categories</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            run(() => savePettyCashCategory(null, name), () => setName(""));
          }}
        >
          <Input placeholder="New category" value={name} onChange={(e) => setName(e.target.value)} className="max-w-xs" aria-label="New category" />
          <Button type="submit" size="sm" disabled={pending}>Add</Button>
        </form>
        <div className="space-y-1">
          {categories.map((c) => (
            <div key={c.id} className="flex items-center justify-between border-b py-1.5 text-sm last:border-0">
              <span className={c.active ? "" : "text-muted-foreground line-through"}>{c.name}</span>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => setPettyCashCategoryActive(c.id, !c.active))}>
                {c.active ? "Deactivate" : "Activate"}
              </Button>
            </div>
          ))}
          {categories.length === 0 && <p className="text-muted-foreground text-sm">No categories yet.</p>}
        </div>
      </CardContent>
    </Card>
  );
}
