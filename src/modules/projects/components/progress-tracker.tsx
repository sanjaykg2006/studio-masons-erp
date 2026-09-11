"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
  addProjectStep,
  deleteProjectStep,
  renameProjectStep,
  toggleProjectStep,
} from "@/modules/projects/actions";
import type { DesignStage, ProjectProgress } from "@/modules/projects/types";

/** A thin filled bar; width is the percentage, with a gentle fill animation. */
function Bar({ pct, className }: { pct: number; className?: string }) {
  return (
    <div className={cn("bg-muted h-2.5 w-full overflow-hidden rounded-full", className)}>
      <div
        className="bg-primary h-full rounded-full transition-[width] duration-500 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function ProgressTracker({
  projectId,
  progress,
  canUpdate,
}: {
  projectId: string;
  progress: ProjectProgress;
  canUpdate: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const current = progress.stages.find((s) => s.stage === progress.currentStage)!;

  // This checklist belongs to THIS project, so editing it here changes nothing
  // anywhere else. The company default lives under Projects -> Templates.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState<DesignStage | null>(null);
  const [newLabel, setNewLabel] = useState("");

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error);
      else {
        setEditing(null);
        setAdding(null);
        setNewLabel("");
        router.refresh();
      }
    });

  const toggle = (stepId: string, done: boolean) =>
    startTransition(async () => {
      setError(null);
      const res = await toggleProjectStep(projectId, stepId, done);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Project progress</CardTitle>
        <CardDescription>
          Each stage fills as its steps are completed. Overall progress weights the
          five stages equally.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && (
          <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-md border px-4 py-2 text-sm">
            {error}
          </div>
        )}

        {/* Overall + current-stage headline bars ----------------------------- */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium">Overall progress</span>
              <span className="text-muted-foreground tabular-nums">
                {progress.overallPct}%
              </span>
            </div>
            <Bar pct={progress.overallPct} />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium">
                Current stage · {current.label}
              </span>
              <span className="text-muted-foreground tabular-nums">{current.pct}%</span>
            </div>
            <Bar pct={current.pct} />
          </div>
        </div>

        {/* Per-stage checklist ---------------------------------------------- */}
        <div className="space-y-5 border-t pt-5">
          {progress.stages.map((stage) => {
            const isCurrent = stage.stage === progress.currentStage;
            return (
              <div key={stage.stage} className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {stage.label}
                    {isCurrent && (
                      <span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs">
                        Current
                      </span>
                    )}
                  </div>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {stage.pct}%
                  </span>
                </div>
                <Bar pct={stage.pct} className="h-1.5" />
                {stage.steps.length === 0 ? (
                  <p className="text-muted-foreground text-xs">No steps defined.</p>
                ) : (
                  <ul className="space-y-1">
                    {stage.steps.map((step) => (
                      <li key={step.id} className="flex items-center gap-2">
                        {editing === step.id ? (
                          <>
                            <Input
                              value={draft}
                              onChange={(e) => setDraft(e.target.value)}
                              className="h-8 flex-1"
                              aria-label="Step text"
                            />
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => run(() => renameProjectStep(projectId, step.id, draft))}
                              className="text-muted-foreground hover:text-foreground text-xs"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditing(null)}
                              className="text-muted-foreground hover:text-foreground text-xs"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                        <>
                        <label
                          className={cn(
                            "flex items-center gap-2 text-sm",
                            canUpdate ? "cursor-pointer" : "cursor-default",
                            step.done && "text-muted-foreground line-through"
                          )}
                        >
                          <input
                            type="checkbox"
                            className="accent-primary size-4"
                            checked={step.done}
                            disabled={!canUpdate || pending}
                            onChange={(e) => toggle(step.id, e.target.checked)}
                          />
                          {step.label}
                        </label>
                        {canUpdate && (
                          <span className="ml-auto flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setEditing(step.id);
                                setDraft(step.label);
                              }}
                              className="text-muted-foreground hover:text-foreground text-xs"
                              aria-label={`Rename ${step.label}`}
                            >
                              Rename
                            </button>
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => run(() => deleteProjectStep(projectId, step.id))}
                              className="text-muted-foreground hover:text-destructive text-xs"
                              aria-label={`Remove ${step.label}`}
                            >
                              Remove
                            </button>
                          </span>
                        )}
                        </>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {canUpdate &&
                  (adding === stage.stage ? (
                    <form
                      className="flex items-center gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!newLabel.trim()) return;
                        run(() => addProjectStep(projectId, stage.stage, newLabel));
                      }}
                    >
                      <Input
                        value={newLabel}
                        onChange={(e) => setNewLabel(e.target.value)}
                        placeholder="New step"
                        className="h-8 flex-1"
                        aria-label="New step"
                        autoFocus
                      />
                      <button type="submit" disabled={pending} className="text-xs underline">
                        Add
                      </button>
                      <button
                        type="button"
                        onClick={() => setAdding(null)}
                        className="text-muted-foreground text-xs"
                      >
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setAdding(stage.stage)}
                      className="text-muted-foreground hover:text-foreground text-xs"
                    >
                      + Add a step
                    </button>
                  ))}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
