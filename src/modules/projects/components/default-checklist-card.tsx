"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ChecklistEditor } from "@/modules/projects/components/checklist-editor";
import {
  addTemplateStep,
  deleteTemplateStep,
  renameTemplateStep,
} from "@/modules/projects/actions";
import type { DesignStageStep } from "@/modules/projects/types";

/**
 * The company's default progress checklist — what a NEW project starts with.
 *
 * Editing here changes nothing on any project that already exists: each of
 * those owns its own copy, edited on the project's own progress card. That is
 * the whole point of the split, so the card says so rather than leaving someone
 * to discover it.
 */
export function DefaultChecklistCard({
  steps,
  canEdit,
}: {
  steps: DesignStageStep[];
  canEdit: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Default progress checklist</CardTitle>
        <CardDescription>
          The steps a <strong>new</strong> project starts with, under each of the
          five stages. Projects that already exist keep their own checklist —
          change those on the project&apos;s Progress card.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {canEdit ? (
          <ChecklistEditor
            steps={steps}
            onAdd={addTemplateStep}
            onRename={renameTemplateStep}
            onDelete={deleteTemplateStep}
          />
        ) : (
          <ul className="text-muted-foreground space-y-1 text-sm">
            {steps.map((s) => (
              <li key={s.id}>{s.label}</li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
