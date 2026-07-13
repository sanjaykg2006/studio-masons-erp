"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowLeft, CheckCircle2, Lock, Pencil, RotateCcw, Send, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { RevisionState } from "@/modules/projects/data";
// The questionnaire tree type comes from the Design template library the brief is built on.
import type { TemplateTree } from "@/modules/design/data";
import type { DesignBrief } from "@/modules/projects/types";
import {
  approveBrief,
  approveBriefRevision,
  discardBriefRevision,
  proposeBriefRevision,
  returnBriefForChanges,
  returnBriefRevision,
  saveBriefAnswer,
  submitBriefForReview,
  submitBriefRevision,
} from "@/modules/projects/actions";
import { BriefStatusBadge } from "@/modules/projects/components/status-badge";

type Props = {
  projectId: string;
  brief: DesignBrief;
  projectName: string;
  tree: TemplateTree;
  answers: Record<string, Record<string, string>>;
  canEdit: boolean;
  canReview: boolean;
  canApprove: boolean;
  frozen: boolean;
  revisionState: RevisionState;
  revisionNo: number;
  canProposeRevision: boolean;
  canApproveRevision: boolean;
};

export function BriefForm({
  projectId,
  brief,
  projectName,
  tree,
  answers: initial,
  canEdit,
  canReview,
  canApprove,
  frozen,
  revisionState,
  revisionNo,
  canProposeRevision,
  canApproveRevision,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState(initial);
  const [savingId, setSavingId] = useState<string | null>(null);

  const locked = !canEdit;

  const setCell = (questionId: string, colKey: string, value: string) =>
    setAnswers((prev) => ({
      ...prev,
      [questionId]: { ...(prev[questionId] ?? {}), [colKey]: value },
    }));

  const persist = (questionId: string) => {
    if (locked) return;
    setSavingId(questionId);
    startTransition(async () => {
      const res = await saveBriefAnswer(brief.id, questionId, answers[questionId] ?? {});
      setSavingId(null);
      if (!res.ok) setError(res.error);
    });
  };

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error);
      else router.refresh();
    });

  return (
    <div className="space-y-6">
      <Link
        href={`/projects/${projectId}`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" /> {projectName}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{tree.template.label}</h1>
            <BriefStatusBadge status={brief.status} />
            {revisionNo > 0 && (
              <span className="text-muted-foreground text-xs">Rev. {revisionNo}</span>
            )}
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            Version {tree.version.version_no} · answers save as you go.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* Pre-freeze brief cycle. */}
          {!frozen && canEdit && brief.status === "in_progress" && (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => submitBriefForReview(brief.id))}>
              <Send className="size-4" /> Submit for review
            </Button>
          )}
          {!frozen && canReview && brief.status === "in_review" && (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => returnBriefForChanges(brief.id))}>
              <RotateCcw className="size-4" /> Return for changes
            </Button>
          )}
          {!frozen && canApprove && brief.status !== "approved" && (
            <Button size="sm" disabled={pending} onClick={() => run(() => approveBrief(brief.id))}>
              <CheckCircle2 className="size-4" /> Approve brief
            </Button>
          )}

          {/* Post-freeze revision cycle. */}
          {canProposeRevision && (
            <Button size="sm" disabled={pending} onClick={() => run(() => proposeBriefRevision(brief.id))}>
              <Pencil className="size-4" /> Propose revision
            </Button>
          )}
          {revisionState === "draft" && canEdit && (
            <Button size="sm" disabled={pending} onClick={() => run(() => submitBriefRevision(brief.id))}>
              <Send className="size-4" /> Submit revision
            </Button>
          )}
          {revisionState === "in_review" && canApproveRevision && (
            <>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => returnBriefRevision(brief.id))}>
                <RotateCcw className="size-4" /> Return for changes
              </Button>
              <Button size="sm" disabled={pending} onClick={() => run(() => approveBriefRevision(brief.id))}>
                <CheckCircle2 className="size-4" /> Approve &amp; publish
              </Button>
            </>
          )}
          {revisionState && (canApproveRevision || canEdit) && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => {
                if (confirm("Discard this revision? The published brief is kept unchanged."))
                  run(() => discardBriefRevision(brief.id));
              }}
            >
              <X className="size-4" /> Discard
            </Button>
          )}
        </div>
      </div>

      {revisionState && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-800 dark:text-amber-300">
          <Pencil className="mt-0.5 size-4 shrink-0" />
          <span>
            {revisionState === "draft"
              ? "Revision in progress — you're editing a draft copy. The published design stays unchanged until the department lead approves it."
              : "Revision submitted — awaiting the department lead's approval to publish. Editing is locked until it's decided."}
          </span>
        </div>
      )}

      {locked && !revisionState && (
        <div className="text-muted-foreground bg-muted flex items-center gap-2 rounded-md px-4 py-2 text-sm">
          <Lock className="size-4" />
          {frozen
            ? "The design is frozen. Propose a revision to change the brief; publishing needs the department lead's approval."
            : brief.status === "approved"
              ? "This brief is approved and locked for editing."
              : "You have read-only access to this brief."}
        </div>
      )}

      {error && (
        <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-md border px-4 py-2 text-sm">
          {error}
        </div>
      )}

      {tree.sections.map((section) => (
        <Card key={section.id}>
          <CardHeader>
            <CardTitle className="text-base">{section.title}</CardTitle>
            {section.questions.length === 0 && (
              <CardDescription>No questions in this section.</CardDescription>
            )}
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left align-bottom">
                  <th className="w-1/2 py-2 font-medium">Question</th>
                  {tree.columns.map((c) => (
                    <th key={c.id} className="px-2 py-2 font-medium">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {section.questions.map((q) => (
                  <tr key={q.id} className="border-b align-top last:border-0">
                    <td className="py-2 pr-3">{q.text}</td>
                    {tree.columns.map((c) => {
                      const value = answers[q.id]?.[c.key] ?? "";
                      const common = {
                        value,
                        disabled: locked,
                        onChange: (
                          e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
                        ) => setCell(q.id, c.key, e.target.value),
                        onBlur: () => persist(q.id),
                        className:
                          "border-input bg-background w-full rounded-md border px-2 py-1 disabled:opacity-60",
                      };
                      return (
                        <td key={c.id} className="px-2 py-1.5">
                          {c.kind === "yes_no" ? (
                            <select {...common} aria-label={`${q.text} ${c.label}`}>
                              <option value="">—</option>
                              <option value="Yes">Yes</option>
                              <option value="No">No</option>
                            </select>
                          ) : c.kind === "longtext" ? (
                            <textarea {...common} rows={2} aria-label={`${q.text} ${c.label}`} />
                          ) : (
                            <input {...common} aria-label={`${q.text} ${c.label}`} />
                          )}
                          {savingId === q.id && (
                            <span className="text-muted-foreground text-[10px]">saving…</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
