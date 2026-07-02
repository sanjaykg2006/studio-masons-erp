"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  decideChangeRequest,
  raiseChangeRequest,
} from "@/modules/design/actions";
import {
  CHANGE_STATUS_LABEL,
  type ChangeRequestStatus,
  type DesignChangeRequest,
} from "@/modules/projects/types";

const STATUS_TONE: Record<ChangeRequestStatus, string> = {
  open: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  approved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  rejected: "bg-muted text-muted-foreground",
};

export function ChangeRequestsCard({
  projectId,
  requests,
  canDecide,
}: {
  projectId: string;
  requests: DesignChangeRequest[];
  canDecide: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", reason: "" });

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error);
      else router.refresh();
    });

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle>Change Order Register</CardTitle>
          <CardDescription>
            After a freeze, changes to approved or issued work go through here.
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => setOpen((o) => !o)}>
          <Plus className="size-4" /> Raise
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-md border px-4 py-2 text-sm">
            {error}
          </div>
        )}

        {open && (
          <form
            className="space-y-2 rounded-md border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!form.title.trim()) return;
              run(async () => {
                const res = await raiseChangeRequest(
                  projectId,
                  form.title,
                  form.reason,
                  null
                );
                if (res.ok) {
                  setForm({ title: "", reason: "" });
                  setOpen(false);
                }
                return res;
              });
            }}
          >
            <Input
              placeholder="What needs to change?"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              aria-label="Change title"
            />
            <Input
              placeholder="Reason (optional)"
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              aria-label="Reason"
            />
            <Button type="submit" size="sm" disabled={pending}>
              Submit request
            </Button>
          </form>
        )}

        {requests.length === 0 ? (
          <p className="text-muted-foreground text-sm">No change requests.</p>
        ) : (
          <ul className="space-y-2">
            {requests.map((r) => (
              <li key={r.id} className="rounded-md border px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{r.title}</p>
                    {r.reason && (
                      <p className="text-muted-foreground text-xs">{r.reason}</p>
                    )}
                    {r.decision_note && (
                      <p className="text-muted-foreground mt-1 text-xs italic">
                        Decision: {r.decision_note}
                      </p>
                    )}
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
                      STATUS_TONE[r.status]
                    )}
                  >
                    {CHANGE_STATUS_LABEL[r.status]}
                  </span>
                </div>
                {canDecide && r.status === "open" && (
                  <div className="mt-2 flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => run(() => decideChangeRequest(r.id, "approved", ""))}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => run(() => decideChangeRequest(r.id, "rejected", ""))}
                    >
                      Reject
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
