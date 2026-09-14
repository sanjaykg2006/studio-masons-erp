"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  APPROVERS,
  APPROVER_LABEL,
  stageNeedsRole,
  stageRules,
  type ApprovalStageRow,
  type Approver,
  type EngineFlow,
  type RoleOption,
} from "@/modules/access/approval-engine";
import {
  deleteApprovalStage,
  moveApprovalStage,
  saveApprovalStage,
  type StageInput,
} from "@/modules/access/approval-actions";

type Option = { id: string; label: string };

const field = "border-input bg-background h-9 rounded-md border px-2 text-sm";

/** Job titles, then one group per department's project roles. */
function roleGroups(roles: RoleOption[], hasProject: boolean) {
  const titles = roles.filter((r) => !r.departmentId);
  const groups: { label: string; roles: RoleOption[] }[] = [
    { label: "Job titles", roles: titles },
  ];
  if (hasProject) {
    for (const r of roles.filter((x) => x.departmentId)) {
      const name = `${r.department} — project roles`;
      const group = groups.find((g) => g.label === name);
      if (group) group.roles.push(r);
      else groups.push({ label: name, roles: [r] });
    }
  }
  return groups.filter((g) => g.roles.length > 0);
}

/**
 * Add, remove, reorder and configure one flow's approval stages. Each stage
 * names ONE role and only that role may give it. The fixed work steps (log,
 * pay, raise…) are not here. Changes apply to items raised from now on; items
 * already in progress keep the stages they started with.
 */
export function ApprovalStagesEditor({
  flow,
  jobTitles,
  roles,
}: {
  flow: EngineFlow;
  jobTitles: Option[];
  roles: RoleOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);

  const titleLabel = (id: string) => jobTitles.find((t) => t.id === id)?.label ?? "a deleted job title";
  const roleOption = (id: string) => roles.find((r) => r.id === id) ?? null;

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, after?: () => void) =>
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
    <div className="space-y-3 rounded-md border border-dashed p-3">
      <div>
        <p className="text-sm font-medium">Edit the approval stages</p>
        <p className="text-muted-foreground text-xs">
          Each stage is given by one role and nobody else. Changes apply to items
          raised from now on; items already in progress keep the stages they
          started with.
        </p>
      </div>

      {error && (
        <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm">
          {error}
        </div>
      )}

      {flow.stages.length === 0 && (
        <p className="text-muted-foreground text-sm">
          No approval stages — items go straight to the next step.
        </p>
      )}

      <ol className="space-y-2">
        {flow.stages.map((s, i) =>
          editing === s.id ? (
            <li key={s.id}>
              <StageForm
                flow={flow}
                stage={s}
                jobTitles={jobTitles}
                pending={pending}
                onCancel={() => setEditing(null)}
                onSave={(input) => run(() => saveApprovalStage(input), () => setEditing(null))}
              />
            </li>
          ) : (
            <li key={s.id} className="flex items-start gap-2 rounded-md bg-accent/30 px-3 py-2 text-sm">
              <div className="flex flex-col pt-0.5">
                <button
                  type="button"
                  disabled={pending || i === 0}
                  onClick={() => run(() => moveApprovalStage(s.id, true))}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                  aria-label={`Move ${s.label} earlier`}
                >
                  <ChevronUp className="size-3" />
                </button>
                <button
                  type="button"
                  disabled={pending || i === flow.stages.length - 1}
                  onClick={() => run(() => moveApprovalStage(s.id, false))}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                  aria-label={`Move ${s.label} later`}
                >
                  <ChevronDown className="size-3" />
                </button>
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {i + 1}. {s.label}
                  {stageNeedsRole(s) && (
                    <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-normal text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
                      needs a role
                    </span>
                  )}
                </p>
                {stageRules(s, roleOption, titleLabel).map((r) => (
                  <p key={r} className="text-muted-foreground text-xs">
                    {r}
                  </p>
                ))}
              </div>
              <div className="flex shrink-0 gap-2 pt-0.5">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setEditing(s.id)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={`Edit ${s.label}`}
                >
                  <Pencil className="size-3.5" />
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    if (confirm(`Remove the "${s.label}" stage? Items already waiting on it are not affected.`))
                      run(() => deleteApprovalStage(s.id));
                  }}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`Remove ${s.label}`}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </li>
          )
        )}
      </ol>

      {editing === "new" ? (
        <StageForm
          flow={flow}
          stage={null}
          jobTitles={jobTitles}
          pending={pending}
          onCancel={() => setEditing(null)}
          onSave={(input) => run(() => saveApprovalStage(input), () => setEditing(null))}
        />
      ) : (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => setEditing("new")}>
          <Plus className="size-4" /> Add a stage
        </Button>
      )}
    </div>
  );
}

function StageForm({
  flow,
  stage,
  jobTitles,
  pending,
  onCancel,
  onSave,
}: {
  flow: EngineFlow;
  stage: ApprovalStageRow | null;
  jobTitles: Option[];
  pending: boolean;
  onCancel: () => void;
  onSave: (input: StageInput) => void;
}) {
  const [label, setLabel] = useState(stage?.label ?? "");
  const [approver, setApprover] = useState<Approver>(stage?.approver ?? "role");
  const [roleId, setRoleId] = useState(stage?.role_id ?? "");
  const [skips, setSkips] = useState<string[]>(stage?.skip_job_title_ids ?? []);
  const [minAmount, setMinAmount] = useState(stage?.min_amount != null ? String(stage.min_amount) : "");
  const [blockOwn, setBlockOwn] = useState(stage?.block_own ?? true);

  // Only the roles this flow may name: job titles, plus project roles from the
  // departments allotted its module.
  const groups = roleGroups(flow.roles, flow.has_project);

  return (
    <form
      className="bg-background space-y-3 rounded-md border p-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          id: stage?.id ?? null,
          flowId: flow.id,
          label,
          approver,
          roleId: approver === "role" ? roleId || null : null,
          skipJobTitleIds: skips,
          minAmount: flow.has_amount && minAmount.trim() !== "" ? Number(minAmount) : null,
          blockOwn,
        });
      }}
    >
      <Input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Stage name, e.g. Billing check"
        aria-label="Stage name"
      />

      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground text-xs">Who approves</span>
        <select
          className={field}
          value={approver}
          onChange={(e) => setApprover(e.target.value as Approver)}
        >
          {APPROVERS.map((a) => (
            <option key={a} value={a}>
              {APPROVER_LABEL[a]}
            </option>
          ))}
        </select>
      </label>

      {approver === "role" && (
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">
            The one role that gives this stage
            {!flow.has_project
              ? " — these items don't belong to a project, so only job titles can give them"
              : " — project roles come from the departments allotted this module"}
          </span>
          <select
            className={field}
            value={roleId}
            onChange={(e) => setRoleId(e.target.value)}
            aria-label="Approving role"
          >
            <option value="">Choose the role…</option>
            {groups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      )}

      <div className="space-y-1">
        <p className="text-muted-foreground text-xs">Skip this stage when the requester&apos;s job title is</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {jobTitles.map((t) => (
            <label key={t.id} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={skips.includes(t.id)}
                onChange={(e) =>
                  setSkips((cur) => (e.target.checked ? [...cur, t.id] : cur.filter((x) => x !== t.id)))
                }
              />
              {t.label}
            </label>
          ))}
        </div>
      </div>

      {flow.has_amount && (
        <label className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-xs">Only for amounts of ₹</span>
          <Input
            inputMode="decimal"
            value={minAmount}
            onChange={(e) => setMinAmount(e.target.value)}
            placeholder="any amount"
            className="h-8 w-32"
            aria-label="Minimum amount"
          />
          <span className="text-muted-foreground text-xs">or more (leave empty for every amount)</span>
        </label>
      )}

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={blockOwn}
          onChange={(e) => setBlockOwn(e.target.checked)}
        />
        The requester can&apos;t approve their own
      </label>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          Save stage
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
