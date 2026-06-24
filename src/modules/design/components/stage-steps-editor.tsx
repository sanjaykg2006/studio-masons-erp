"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Plus, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addStageStep,
  deleteStageStep,
  updateStageStep,
} from "@/modules/design/actions";
import {
  DESIGN_STAGES,
  DESIGN_STAGE_LABEL,
  type DesignStage,
  type DesignStageStep,
} from "@/modules/design/types";

/** Edit the checklist steps that drive every project's progress bars. */
export function StageStepsEditor({ steps }: { steps: DesignStageStep[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
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

  return (
    <div className="space-y-5">
      {error && (
        <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-md border px-4 py-2 text-sm">
          {error}
        </div>
      )}

      {DESIGN_STAGES.map((stage) => {
        const stageSteps = steps
          .filter((s) => s.stage === stage)
          .sort((a, b) => a.sort - b.sort);
        return (
          <div key={stage} className="space-y-2">
            <h3 className="text-sm font-medium">{DESIGN_STAGE_LABEL[stage]}</h3>
            <ul className="space-y-1.5">
              {stageSteps.map((step) => (
                <li
                  key={step.id}
                  className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm"
                >
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
                        onClick={() => run(() => updateStageStep(step.id, draft))}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label="Save"
                      >
                        <Check className="size-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(null)}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label="Cancel"
                      >
                        <X className="size-4" />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(step.id);
                          setDraft(step.label);
                        }}
                        className="flex-1 text-left hover:underline"
                      >
                        {step.label}
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => run(() => deleteStageStep(step.id))}
                        className="text-muted-foreground hover:text-destructive"
                        aria-label="Delete step"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>

            {adding === stage ? (
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!newLabel.trim()) return;
                  run(() => addStageStep(stage, newLabel));
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
                <Button type="submit" size="sm" disabled={pending}>
                  Add
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setAdding(null)}
                >
                  Cancel
                </Button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setAdding(stage);
                  setNewLabel("");
                }}
                className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
              >
                <Plus className="size-3.5" /> Add step
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
