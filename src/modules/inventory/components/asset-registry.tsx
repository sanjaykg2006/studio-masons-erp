"use client";

import { useRouter } from "next/navigation";
import { Fragment, type FormEvent, useState, useTransition } from "react";
import { ArrowLeftRight, Check, Pencil, Plus, Trash2, UserPlus, X } from "lucide-react";

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
  ASSET_STATUS_LABEL,
  type Asset,
  type AssetCategoryTotal,
  type AssetInput,
  type AssetStatus,
  type PickerOption,
} from "@/modules/inventory/types";
import {
  acceptAssetTransfer,
  assignAsset,
  cancelAssetTransfer,
  deleteAsset,
  rejectAssetTransfer,
  requestAssetTransfer,
  saveAsset,
  setAssetStatus,
} from "@/modules/inventory/actions";

type Result = { ok: true } | { ok: false; error: string };

const field = "border-input bg-background h-9 rounded-md border px-2 text-sm";

const STATUS_TONE: Record<AssetStatus, string> = {
  in_use: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  idle: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  retired: "bg-muted text-muted-foreground",
};

const EMPTY: AssetInput = { name: "", category: "", tag: "", notes: "" };

export function AssetRegistry({
  assets,
  totals,
  projects,
  people,
  canCreate,
  canManage,
  canDelete,
}: {
  assets: Asset[];
  totals: AssetCategoryTotal[];
  projects: PickerOption[];
  people: PickerOption[];
  canCreate: boolean;
  canManage: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [transferring, setTransferring] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<string | null>(null);

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

  const incoming = assets.filter((a) => a.is_incoming_to_me && a.pending_transfer_id);

  const remove = (a: Asset) => {
    if (!confirm(`Remove asset "${a.name}" from the registry?`)) return;
    run(() => deleteAsset(a.id));
  };

  return (
    <div className="space-y-4">
      {/* Totals strip -------------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-2">
        {totals.length === 0 ? (
          <span className="text-muted-foreground text-sm">No assets yet.</span>
        ) : (
          totals.map((t) => (
            <span
              key={t.category}
              className="bg-muted inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm"
            >
              <span className="font-medium capitalize">{t.category}</span>
              <span className="text-muted-foreground">{t.count}</span>
            </span>
          ))
        )}
        {canCreate && (
          <Button
            size="sm"
            className="ml-auto"
            onClick={() => {
              setAdding((a) => !a);
              setEditing(null);
            }}
          >
            <Plus className="size-4" /> Add asset
          </Button>
        )}
      </div>

      {error && (
        <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-md border px-4 py-2 text-sm">
          {error}
        </div>
      )}

      {adding && canCreate && (
        <AssetForm
          title="New asset"
          initial={EMPTY}
          pending={pending}
          onCancel={() => setAdding(false)}
          onSubmit={(input) => run(() => saveAsset(null, input), () => setAdding(false))}
        />
      )}

      {/* Incoming transfers awaiting my acceptance --------------------------- */}
      {incoming.length > 0 && (
        <Card className="border-blue-500/40">
          <CardHeader>
            <CardTitle className="text-base">Transfers awaiting your acceptance</CardTitle>
            <CardDescription>
              Someone wants to hand these assets over to you. Accept to take custody.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {incoming.map((a) => (
              <div
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 text-sm last:border-0 last:pb-0"
              >
                <span>
                  <span className="font-medium">{a.name}</span>{" "}
                  <span className="text-muted-foreground">
                    → {a.pending_to_project_name ?? "a project"}
                  </span>
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() => run(() => acceptAssetTransfer(a.pending_transfer_id!))}
                  >
                    <Check className="size-4" /> Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => run(() => rejectAssetTransfer(a.pending_transfer_id!))}
                  >
                    Decline
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Registry ------------------------------------------------------------ */}
      <Card>
        <CardContent className="pt-6">
          {assets.length === 0 ? (
            <p className="text-muted-foreground text-sm">No assets registered yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-left">
                    <th className="py-2 font-medium">Asset</th>
                    <th className="py-2 font-medium">Category</th>
                    <th className="py-2 font-medium">Current project</th>
                    <th className="py-2 font-medium">Custodian</th>
                    <th className="py-2 font-medium">Status</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {assets.map((a) => (
                    <Fragment key={a.id}>
                      <tr className="border-b last:border-0">
                        <td className="py-2 font-medium">
                          {a.name}
                          {a.tag && <span className="text-muted-foreground"> · {a.tag}</span>}
                        </td>
                        <td className="text-muted-foreground py-2 capitalize">{a.category}</td>
                        <td className="text-muted-foreground py-2">
                          {a.current_project_name ?? "—"}
                        </td>
                        <td className="text-muted-foreground py-2">{a.custodian_name ?? "—"}</td>
                        <td className="py-2">
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[10px] font-medium",
                              STATUS_TONE[a.status]
                            )}
                          >
                            {ASSET_STATUS_LABEL[a.status]}
                          </span>
                          {a.pending_transfer_id && !a.is_incoming_to_me && (
                            <span className="text-muted-foreground ml-2 text-xs">
                              transfer pending
                            </span>
                          )}
                        </td>
                        <td className="py-2">
                          <div className="flex items-center justify-end gap-1">
                            {canDelete && a.status !== "retired" && !a.pending_transfer_id && (
                              <button
                                type="button"
                                disabled={pending}
                                onClick={() => {
                                  setAssigning((id) => (id === a.id ? null : a.id));
                                  setTransferring(null);
                                  setEditing(null);
                                }}
                                className="text-muted-foreground hover:text-foreground"
                                title="Place directly (senior)"
                                aria-label={`Place ${a.name} directly`}
                              >
                                <UserPlus className="size-4" />
                              </button>
                            )}
                            {canManage && a.status !== "retired" && !a.pending_transfer_id && (
                              <button
                                type="button"
                                disabled={pending}
                                onClick={() => {
                                  setTransferring((id) => (id === a.id ? null : a.id));
                                  setAssigning(null);
                                }}
                                className="text-muted-foreground hover:text-foreground"
                                title="Transfer"
                                aria-label={`Transfer ${a.name}`}
                              >
                                <ArrowLeftRight className="size-4" />
                              </button>
                            )}
                            {canManage && a.pending_transfer_id && !a.is_incoming_to_me && (
                              <button
                                type="button"
                                disabled={pending}
                                onClick={() => run(() => cancelAssetTransfer(a.pending_transfer_id!))}
                                className="text-muted-foreground hover:text-destructive"
                                title="Cancel pending transfer"
                                aria-label={`Cancel transfer of ${a.name}`}
                              >
                                <X className="size-4" />
                              </button>
                            )}
                            {canManage && (
                              <button
                                type="button"
                                disabled={pending}
                                onClick={() => {
                                  setEditing((id) => (id === a.id ? null : a.id));
                                  setTransferring(null);
                                  setAssigning(null);
                                }}
                                className="text-muted-foreground hover:text-foreground"
                                title="Edit"
                                aria-label={`Edit ${a.name}`}
                              >
                                <Pencil className="size-4" />
                              </button>
                            )}
                            {canDelete && (
                              <button
                                type="button"
                                disabled={pending}
                                onClick={() => remove(a)}
                                className="text-muted-foreground hover:text-destructive"
                                title="Remove"
                                aria-label={`Remove ${a.name}`}
                              >
                                <Trash2 className="size-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {editing === a.id && canManage && (
                        <tr>
                          <td colSpan={6} className="pb-3">
                            <AssetForm
                              title={`Edit ${a.name}`}
                              initial={{
                                name: a.name,
                                category: a.category,
                                tag: a.tag ?? "",
                                notes: a.notes ?? "",
                              }}
                              pending={pending}
                              onCancel={() => setEditing(null)}
                              onSubmit={(input) =>
                                run(() => saveAsset(a.id, input), () => setEditing(null))
                              }
                              extra={
                                <div className="flex flex-wrap items-center gap-2">
                                  {a.status !== "retired" ? (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      disabled={pending}
                                      onClick={() => run(() => setAssetStatus(a.id, "retired"))}
                                    >
                                      Retire
                                    </Button>
                                  ) : (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      disabled={pending}
                                      onClick={() => run(() => setAssetStatus(a.id, "idle"))}
                                    >
                                      Reactivate
                                    </Button>
                                  )}
                                  {canDelete && (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      disabled={pending}
                                      onClick={() => run(() => assignAsset(a.id, null, null))}
                                      title="Remove from its current project (mark idle) — senior only"
                                    >
                                      Unassign
                                    </Button>
                                  )}
                                </div>
                              }
                            />
                          </td>
                        </tr>
                      )}
                      {transferring === a.id && canManage && (
                        <tr>
                          <td colSpan={6} className="pb-3">
                            <TransferForm
                              asset={a}
                              projects={projects}
                              people={people}
                              pending={pending}
                              onCancel={() => setTransferring(null)}
                              onSubmit={(toProject, toCustodian, note) =>
                                run(
                                  () => requestAssetTransfer(a.id, toProject, toCustodian, note),
                                  () => setTransferring(null)
                                )
                              }
                            />
                          </td>
                        </tr>
                      )}
                      {assigning === a.id && canDelete && (
                        <tr>
                          <td colSpan={6} className="pb-3">
                            <AssignForm
                              asset={a}
                              projects={projects}
                              people={people}
                              pending={pending}
                              onCancel={() => setAssigning(null)}
                              onSubmit={(project, custodian) =>
                                run(
                                  () => assignAsset(a.id, project, custodian),
                                  () => setAssigning(null)
                                )
                              }
                            />
                          </td>
                        </tr>
                      )}
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

/** Create / edit form for an asset's own fields. */
function AssetForm({
  title,
  initial,
  pending,
  onSubmit,
  onCancel,
  extra,
}: {
  title: string;
  initial: AssetInput;
  pending: boolean;
  onSubmit: (input: AssetInput) => void;
  onCancel: () => void;
  extra?: React.ReactNode;
}) {
  const [form, setForm] = useState<AssetInput>(initial);
  const set = (patch: Partial<AssetInput>) => setForm((f) => ({ ...f, ...patch }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    onSubmit(form);
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>Only the name is required.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              placeholder="Asset name"
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              className="sm:flex-1"
              aria-label="Asset name"
            />
            <Input
              placeholder="Category (e.g. Excavator, Laptop)"
              value={form.category}
              onChange={(e) => set({ category: e.target.value })}
              className="sm:w-48"
              aria-label="Asset category"
            />
            <Input
              placeholder="Tag / serial (optional)"
              value={form.tag}
              onChange={(e) => set({ tag: e.target.value })}
              className="sm:w-48"
              aria-label="Asset tag"
            />
          </div>
          <Input
            placeholder="Notes (optional)"
            value={form.notes}
            onChange={(e) => set({ notes: e.target.value })}
            aria-label="Asset notes"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              Save
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            {extra}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * Direct assign/place: set an asset's project + custodian straight away (no
 * acceptance step). For initial placement or an admin fix — use Transfer when the
 * receiving person should confirm the handover.
 */
function AssignForm({
  asset,
  projects,
  people,
  pending,
  onSubmit,
  onCancel,
}: {
  asset: Asset;
  projects: PickerOption[];
  people: PickerOption[];
  pending: boolean;
  onSubmit: (project: string | null, custodian: string | null) => void;
  onCancel: () => void;
}) {
  const [project, setProject] = useState(asset.current_project_id ?? "");
  const [custodian, setCustodian] = useState(asset.custodian_id ?? "");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!custodian) return;
    onSubmit(project || null, custodian || null);
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Assign {asset.name}</CardTitle>
        <CardDescription>
          Place this asset with a project and custodian now — no acceptance needed.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              className={cn(field, "sm:flex-1")}
              value={project}
              onChange={(e) => setProject(e.target.value)}
              aria-label="Assign to project"
            >
              <option value="">No project (idle)</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select
              className={cn(field, "sm:flex-1")}
              value={custodian}
              onChange={(e) => setCustodian(e.target.value)}
              aria-label="Custodian"
            >
              <option value="">Choose custodian…</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending || !custodian}>
              Assign
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

/** Transfer-request form: target project + new custodian + note. */
function TransferForm({
  asset,
  projects,
  people,
  pending,
  onSubmit,
  onCancel,
}: {
  asset: Asset;
  projects: PickerOption[];
  people: PickerOption[];
  pending: boolean;
  onSubmit: (toProject: string, toCustodian: string, note: string) => void;
  onCancel: () => void;
}) {
  const [toProject, setToProject] = useState("");
  const [toCustodian, setToCustodian] = useState("");
  const [note, setNote] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!toProject || !toCustodian) return;
    onSubmit(toProject, toCustodian, note);
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Transfer {asset.name}</CardTitle>
        <CardDescription>
          The new custodian must accept before the asset moves.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              className={cn(field, "sm:flex-1")}
              value={toProject}
              onChange={(e) => setToProject(e.target.value)}
              aria-label="Transfer to project"
            >
              <option value="">Transfer to project…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select
              className={cn(field, "sm:flex-1")}
              value={toCustodian}
              onChange={(e) => setToCustodian(e.target.value)}
              aria-label="New custodian"
            >
              <option value="">New custodian…</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <Input
            placeholder="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-label="Transfer note"
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending || !toProject || !toCustodian}>
              Send transfer
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
