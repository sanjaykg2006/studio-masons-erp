"use client";

import { useRouter } from "next/navigation";
import { Fragment, type FormEvent, useState, useTransition } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";

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
  VENDOR_STATUS_LABEL,
  VENDOR_TYPE_LABEL,
  type Vendor,
  type VendorInput,
  type VendorStatus,
  type VendorType,
} from "@/modules/procurement/types";
import {
  createVendor,
  decideVendor,
  deleteVendor,
  setVendorStatus,
  updateVendor,
} from "@/modules/procurement/actions";

const STATUS_TONE: Record<VendorStatus, string> = {
  draft: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  approved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  rejected: "bg-muted text-muted-foreground",
};

const field = "border-input bg-background h-9 rounded-md border px-2 text-sm";

const EMPTY: VendorInput = {
  name: "",
  type: "supplier",
  trade: "",
  contact_name: "",
  contact_phone: "",
  contact_email: "",
  address: "",
  gst: "",
  pan: "",
};

const toInput = (v: Vendor): VendorInput => ({
  name: v.name,
  type: v.type,
  trade: v.trade ?? "",
  contact_name: v.contact_name ?? "",
  contact_phone: v.contact_phone ?? "",
  contact_email: v.contact_email ?? "",
  address: v.address ?? "",
  gst: v.gst ?? "",
  pan: v.pan ?? "",
});

export function VendorDirectory({
  vendors,
  canCreate,
  canUpdate,
  canApprove,
  canDelete,
}: {
  vendors: Vendor[];
  canCreate: boolean;
  canUpdate: boolean;
  canApprove: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const run = (
    fn: () => Promise<{ ok: true } | { ok: false; error: string }>,
    after?: () => void
  ) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error);
      else {
        after?.();
        router.refresh();
      }
    });

  const remove = (v: Vendor) => {
    if (!confirm(`Remove vendor "${v.name}" from the directory?`)) return;
    run(() => deleteVendor(v.id));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Vendor directory</h1>
          <p className="text-muted-foreground">
            The company&apos;s suppliers, subcontractors and service providers. A new
            vendor stays <span className="font-medium">Pending</span> until Finance
            marks it approved.
          </p>
        </div>
        {canCreate && (
          <Button
            size="sm"
            onClick={() => {
              setAdding((a) => !a);
              setEditing(null);
            }}
          >
            <Plus className="size-4" /> Add vendor
          </Button>
        )}
      </div>

      {error && (
        <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-md border px-4 py-2 text-sm">
          {error}
        </div>
      )}

      {adding && canCreate && (
        <VendorForm
          title="New vendor"
          initial={EMPTY}
          pending={pending}
          onCancel={() => setAdding(false)}
          onSubmit={(input) => run(() => createVendor(input), () => setAdding(false))}
        />
      )}

      <Card>
        <CardContent className="pt-6">
          {vendors.length === 0 ? (
            <p className="text-muted-foreground text-sm">No vendors yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left">
                  <th className="py-2 font-medium">Vendor</th>
                  <th className="py-2 font-medium">Type</th>
                  <th className="py-2 font-medium">Trade</th>
                  <th className="py-2 font-medium">Contact</th>
                  <th className="py-2 font-medium">Status</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {vendors.map((v) => (
                  <Fragment key={v.id}>
                    <tr className="border-b last:border-0">
                      <td className="py-2 font-medium">{v.name}</td>
                      <td className="text-muted-foreground py-2">{VENDOR_TYPE_LABEL[v.type]}</td>
                      <td className="text-muted-foreground py-2">{v.trade ?? "—"}</td>
                      <td className="text-muted-foreground py-2">
                        {v.contact_name ?? v.contact_phone ?? v.contact_email ?? "—"}
                      </td>
                      <td className="py-2">
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-medium",
                            STATUS_TONE[v.status]
                          )}
                          title={
                            v.status === "approved" && v.approved_by_name
                              ? `Approved by ${v.approved_by_name}`
                              : undefined
                          }
                        >
                          {VENDOR_STATUS_LABEL[v.status]}
                        </span>
                        {v.status === "draft" && v.stage_label && (
                          <span className="text-muted-foreground block text-[10px]">
                            waiting for {v.stage_label}
                          </span>
                        )}
                      </td>
                      <td className="py-2">
                        <div className="flex items-center justify-end gap-1">
                          {/* Waiting on its approval stages: decided there. */}
                          {v.status === "draft" && v.can_approve && v.approval_id && (
                            <>
                              <button
                                type="button"
                                disabled={pending}
                                onClick={() => run(() => decideVendor(v.approval_id!, true, ""))}
                                className="text-muted-foreground hover:text-emerald-600"
                                title={v.stage_label ? `Give: ${v.stage_label}` : "Approve"}
                                aria-label={`Approve ${v.name}`}
                              >
                                <Check className="size-4" />
                              </button>
                              <button
                                type="button"
                                disabled={pending}
                                onClick={() => {
                                  const note = prompt(`Reject "${v.name}" — reason?`);
                                  if (note === null) return;
                                  run(() => decideVendor(v.approval_id!, false, note));
                                }}
                                className="text-muted-foreground hover:text-destructive"
                                title="Reject"
                                aria-label={`Reject ${v.name}`}
                              >
                                <X className="size-4" />
                              </button>
                            </>
                          )}
                          {/* Already decided: Finance may still re-status it. */}
                          {canApprove && v.status === "rejected" && (
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => run(() => setVendorStatus(v.id, "approved"))}
                              className="text-muted-foreground hover:text-emerald-600"
                              title="Approve"
                              aria-label={`Approve ${v.name}`}
                            >
                              <Check className="size-4" />
                            </button>
                          )}
                          {canApprove && v.status === "approved" && (
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => run(() => setVendorStatus(v.id, "rejected"))}
                              className="text-muted-foreground hover:text-destructive"
                              title="Reject"
                              aria-label={`Reject ${v.name}`}
                            >
                              <X className="size-4" />
                            </button>
                          )}
                          {canUpdate && (
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => {
                                setEditing((id) => (id === v.id ? null : v.id));
                                setAdding(false);
                              }}
                              className="text-muted-foreground hover:text-foreground"
                              title="Edit"
                              aria-label={`Edit ${v.name}`}
                            >
                              <Pencil className="size-4" />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => remove(v)}
                              className="text-muted-foreground hover:text-destructive"
                              title="Remove"
                              aria-label={`Remove ${v.name}`}
                            >
                              <Trash2 className="size-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {editing === v.id && canUpdate && (
                      <tr>
                        <td colSpan={6} className="pb-3">
                          <VendorForm
                            title={`Edit ${v.name}`}
                            initial={toInput(v)}
                            pending={pending}
                            onCancel={() => setEditing(null)}
                            onSubmit={(input) =>
                              run(() => updateVendor(v.id, input), () => setEditing(null))
                            }
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** The shared create/edit form. */
function VendorForm({
  title,
  initial,
  pending,
  onSubmit,
  onCancel,
}: {
  title: string;
  initial: VendorInput;
  pending: boolean;
  onSubmit: (input: VendorInput) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<VendorInput>(initial);
  const set = (patch: Partial<VendorInput>) => setForm((f) => ({ ...f, ...patch }));

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
              placeholder="Vendor name"
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              className="sm:flex-1"
              aria-label="Vendor name"
            />
            <select
              className={cn(field, "sm:w-48")}
              value={form.type}
              onChange={(e) => set({ type: e.target.value as VendorType })}
              aria-label="Vendor type"
            >
              {(["supplier", "subcontractor", "service"] as VendorType[]).map((t) => (
                <option key={t} value={t}>
                  {VENDOR_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
            <Input
              placeholder="Trade / category"
              value={form.trade}
              onChange={(e) => set({ trade: e.target.value })}
              className="sm:w-56"
              aria-label="Trade or category"
            />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              placeholder="Contact name"
              value={form.contact_name}
              onChange={(e) => set({ contact_name: e.target.value })}
              className="sm:flex-1"
              aria-label="Contact name"
            />
            <Input
              placeholder="Phone"
              value={form.contact_phone}
              onChange={(e) => set({ contact_phone: e.target.value })}
              className="sm:w-48"
              aria-label="Contact phone"
            />
            <Input
              placeholder="Email"
              type="email"
              value={form.contact_email}
              onChange={(e) => set({ contact_email: e.target.value })}
              className="sm:w-56"
              aria-label="Contact email"
            />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              placeholder="GSTIN"
              value={form.gst}
              onChange={(e) => set({ gst: e.target.value })}
              className="sm:w-56"
              aria-label="Vendor GSTIN"
            />
            <Input
              placeholder="PAN"
              value={form.pan}
              onChange={(e) => set({ pan: e.target.value })}
              className="sm:w-48"
              aria-label="Vendor PAN"
            />
            <textarea
              placeholder="Registered address"
              value={form.address}
              onChange={(e) => set({ address: e.target.value })}
              rows={2}
              className={cn(field, "h-auto resize-y py-2 sm:flex-1")}
              aria-label="Vendor address"
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              Save
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
