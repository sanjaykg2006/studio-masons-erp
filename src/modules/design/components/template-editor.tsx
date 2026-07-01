"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowLeft, ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { TemplateTree } from "@/modules/design/data";
import {
  addQuestion,
  addSection,
  deleteQuestion,
  deleteSection,
  moveQuestion,
  moveSection,
  publishTemplateVersion,
  startTemplateDraft,
  updateQuestion,
  updateSection,
} from "@/modules/design/actions";

type ActionRes = { ok: true } | { ok: false; error: string };

export function TemplateEditor({
  templateId,
  tree,
  canEdit,
  canApprove,
  backHref,
}: {
  templateId: string;
  tree: TemplateTree;
  canEdit: boolean;
  canApprove: boolean;
  backHref: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [newSection, setNewSection] = useState("");

  const isDraft = tree.version.status === "draft";
  const editable = canEdit && isDraft;

  const run = (fn: () => Promise<ActionRes>) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error);
      else router.refresh();
    });

  return (
    <div className="space-y-6">
      <Link
        href={backHref}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" /> All templates
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{tree.template.label}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Version {tree.version.version_no} · {tree.version.status}
          </p>
        </div>
        <div className="flex gap-2">
          {canEdit && !isDraft && (
            <Button size="sm" disabled={pending} onClick={() => run(() => startTemplateDraft(templateId))}>
              Edit (new draft)
            </Button>
          )}
          {canApprove && isDraft && (
            <Button size="sm" disabled={pending} onClick={() => run(() => publishTemplateVersion(tree.version.id))}>
              Approve &amp; publish
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-md border px-4 py-2 text-sm">
          {error}
        </div>
      )}

      {!isDraft && canEdit && (
        <div className="text-muted-foreground bg-muted rounded-md px-4 py-2 text-sm">
          This is the published version (read-only). Choose “Edit (new draft)” to
          make changes — they publish as a new version.
        </div>
      )}

      {/* Response columns (read-only) -------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Response columns</CardTitle>
          <CardDescription>
            The answer fields shown against each question.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {tree.columns.map((c) => (
              <span key={c.id} className="bg-muted rounded-md px-2 py-1 text-xs">
                {c.label} <span className="text-muted-foreground">({c.kind})</span>
              </span>
            ))}
            {tree.columns.length === 0 && (
              <span className="text-muted-foreground text-sm">No columns.</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Sections + questions ---------------------------------------------- */}
      {tree.sections.map((section, si) => (
        <Card key={section.id}>
          <CardHeader>
            <div className="flex items-center gap-2">
              {editable ? (
                <input
                  defaultValue={section.title}
                  onBlur={(e) =>
                    e.target.value.trim() !== section.title &&
                    run(() => updateSection(section.id, e.target.value))
                  }
                  className="border-input bg-background flex-1 rounded-md border px-2 py-1 text-base font-semibold"
                  aria-label="Section title"
                />
              ) : (
                <CardTitle className="flex-1 text-base">{section.title}</CardTitle>
              )}
              {editable && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={pending || si === 0}
                    onClick={() => run(() => moveSection(tree.version.id, section.id, "up"))}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                    aria-label="Move section up"
                  >
                    <ChevronUp className="size-4" />
                  </button>
                  <button
                    type="button"
                    disabled={pending || si === tree.sections.length - 1}
                    onClick={() => run(() => moveSection(tree.version.id, section.id, "down"))}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                    aria-label="Move section down"
                  >
                    <ChevronDown className="size-4" />
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      if (confirm("Delete this section and its questions?"))
                        run(() => deleteSection(section.id));
                    }}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label="Delete section"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {section.questions.map((q, qi) => (
              <div key={q.id} className="flex items-center gap-2">
                {editable ? (
                  <input
                    defaultValue={q.text}
                    onBlur={(e) =>
                      e.target.value.trim() !== q.text &&
                      run(() => updateQuestion(q.id, e.target.value))
                    }
                    className="border-input bg-background flex-1 rounded-md border px-2 py-1 text-sm"
                    aria-label="Question"
                  />
                ) : (
                  <p className="flex-1 text-sm">{q.text}</p>
                )}
                {editable && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={pending || qi === 0}
                      onClick={() => run(() => moveQuestion(section.id, q.id, "up"))}
                      className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                      aria-label="Move question up"
                    >
                      <ChevronUp className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={pending || qi === section.questions.length - 1}
                      onClick={() => run(() => moveQuestion(section.id, q.id, "down"))}
                      className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                      aria-label="Move question down"
                    >
                      <ChevronDown className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => run(() => deleteQuestion(q.id))}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Delete question"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ))}
            {editable && <AddQuestion sectionId={section.id} onAdd={run} />}
          </CardContent>
        </Card>
      ))}

      {editable && (
        <Card>
          <CardContent className="pt-6">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!newSection.trim()) return;
                run(async () => {
                  const res = await addSection(tree.version.id, newSection);
                  if (res.ok) setNewSection("");
                  return res;
                });
              }}
            >
              <Input
                placeholder="New section title"
                value={newSection}
                onChange={(e) => setNewSection(e.target.value)}
                aria-label="New section title"
              />
              <Button type="submit" size="sm" disabled={pending}>
                <Plus className="size-4" /> Section
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function AddQuestion({
  sectionId,
  onAdd,
}: {
  sectionId: string;
  onAdd: (fn: () => Promise<ActionRes>) => void;
}) {
  const [text, setText] = useState("");
  return (
    <form
      className="flex gap-2 pt-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        onAdd(async () => {
          const res = await addQuestion(sectionId, text);
          if (res.ok) setText("");
          return res;
        });
      }}
    >
      <Input
        placeholder="Add a question"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="h-8"
        aria-label="Add a question"
      />
      <Button type="submit" size="sm" variant="outline">
        <Plus className="size-4" />
      </Button>
    </form>
  );
}
