"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";
import { Pencil, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { BillingBranch } from "@/modules/finance/types";
import { saveBillingBranch, setBillingBranchActive } from "@/modules/finance/actions";

type Result = { ok: true } | { ok: false; error: string };
type Draft = { name: string; gstin: string; address: string; placeOfSupply: string };
const EMPTY: Draft = { name: "", gstin: "", address: "", placeOfSupply: "" };

export function BillingBranches({
  branches,
  canManage,
}: {
  branches: BillingBranch[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Billing branches</h1>
        <p className="text-muted-foreground">
          The company&apos;s GST registrations. A branch is chosen on each purchase order.
        </p>
      </div>

      {error && (
        <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-md border px-4 py-2 text-sm">
          {error}
        </div>
      )}

      {canManage && (
        <div>
          <Button size="sm" onClick={() => { setAdding((a) => !a); setEditing(null); }}>
            <Plus className="size-4" /> Add branch
          </Button>
        </div>
      )}

      {adding && canManage && (
        <BranchForm
          title="New branch"
          initial={EMPTY}
          pending={pending}
          onCancel={() => setAdding(false)}
          onSubmit={(d) => run(() => saveBillingBranch(null, d.name, d.gstin, d.address, d.placeOfSupply), () => setAdding(false))}
        />
      )}

      <Card>
        <CardContent className="pt-6">
          {branches.length === 0 ? (
            <p className="text-muted-foreground text-sm">No billing branches yet.</p>
          ) : (
            <div className="space-y-2">
              {branches.map((b) => (
                <div key={b.id}>
                  <div className="flex items-center justify-between border-b py-2 last:border-0">
                    <div>
                      <span className="font-medium">{b.name}</span>
                      {b.gstin && <span className="text-muted-foreground text-xs"> · {b.gstin}</span>}
                      {!b.active && <span className="text-muted-foreground text-xs"> · inactive</span>}
                      {b.address && <div className="text-muted-foreground text-xs">{b.address}</div>}
                    </div>
                    {canManage && (
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => setBillingBranchActive(b.id, !b.active))}>
                          {b.active ? "Deactivate" : "Activate"}
                        </Button>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => setEditing((id) => (id === b.id ? null : b.id))}
                          className="text-muted-foreground hover:text-foreground"
                          aria-label={`Edit ${b.name}`}
                        >
                          <Pencil className="size-4" />
                        </button>
                      </div>
                    )}
                  </div>
                  {editing === b.id && canManage && (
                    <div className="pb-3">
                      <BranchForm
                        title={`Edit ${b.name}`}
                        initial={{ name: b.name, gstin: b.gstin ?? "", address: b.address ?? "", placeOfSupply: b.place_of_supply ?? "" }}
                        pending={pending}
                        onCancel={() => setEditing(null)}
                        onSubmit={(d) => run(() => saveBillingBranch(b.id, d.name, d.gstin, d.address, d.placeOfSupply), () => setEditing(null))}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BranchForm({
  title,
  initial,
  pending,
  onSubmit,
  onCancel,
}: {
  title: string;
  initial: Draft;
  pending: boolean;
  onSubmit: (d: Draft) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<Draft>(initial);
  const set = (patch: Partial<Draft>) => setForm((f) => ({ ...f, ...patch }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    onSubmit(form);
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input placeholder="Branch name" value={form.name} onChange={(e) => set({ name: e.target.value })} className="sm:flex-1" aria-label="Branch name" />
            <Input placeholder="GSTIN" value={form.gstin} onChange={(e) => set({ gstin: e.target.value })} className="sm:w-56" aria-label="GSTIN" />
          </div>
          <Input placeholder="Address (optional)" value={form.address} onChange={(e) => set({ address: e.target.value })} aria-label="Address" />
          {/* Both of these print on every PO issued from this branch. */}
          <Input placeholder="Place of supply, e.g. Karnataka" value={form.placeOfSupply} onChange={(e) => set({ placeOfSupply: e.target.value })} aria-label="Place of supply" />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>Save</Button>
            <Button type="button" size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
