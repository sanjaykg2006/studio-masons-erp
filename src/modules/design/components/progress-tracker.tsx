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
import { toggleProjectStep } from "@/modules/design/actions";
import type { ProjectProgress } from "@/modules/design/types";

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
                      <li key={step.id}>
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
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
