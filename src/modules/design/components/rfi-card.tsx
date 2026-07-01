"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";
import { ArrowUpCircle, CheckCircle2, MessageSquare, Plus, X } from "lucide-react";

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
  RFI_STATUS_LABEL,
  type DepartmentRef,
  type RfiMessage,
  type RfiRow,
  type RfiStatus,
} from "@/modules/design/rfi-types";
import {
  closeRfi,
  escalateRfi,
  loadRfiThread,
  postRfiMessage,
  raiseRfi,
} from "@/modules/design/rfi-actions";

const STATUS_TONE: Record<RfiStatus, string> = {
  open: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  answered: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  closed: "bg-muted text-muted-foreground",
};

const field = "border-input bg-background h-9 rounded-md border px-2 text-sm";

export function RfiCard({
  projectId,
  rfis,
  departments,
}: {
  projectId: string;
  rfis: RfiRow[];
  departments: DepartmentRef[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [toDept, setToDept] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const [expanded, setExpanded] = useState<string | null>(null);
  const [threads, setThreads] = useState<Record<string, RfiMessage[]>>({});
  const [reply, setReply] = useState("");

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

  const submitNew = (e: FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !toDept) return;
    run(
      () => raiseRfi(projectId, toDept, subject, body),
      () => {
        setSubject("");
        setBody("");
        setToDept("");
        setOpen(false);
      }
    );
  };

  const toggle = async (rfiId: string) => {
    if (expanded === rfiId) {
      setExpanded(null);
      return;
    }
    setExpanded(rfiId);
    setReply("");
    if (!threads[rfiId]) {
      const res = await loadRfiThread(rfiId);
      if (res.ok) setThreads((t) => ({ ...t, [rfiId]: res.messages }));
      else setError(res.error);
    }
  };

  const sendReply = (rfi: RfiRow, asAnswer: boolean) => {
    if (!reply.trim()) return;
    run(
      () => postRfiMessage(projectId, rfi.id, reply, asAnswer),
      () => {
        setReply("");
        setThreads((t) => {
          const copy = { ...t };
          delete copy[rfi.id]; // force reload on next expand
          return copy;
        });
      }
    );
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Questions (RFIs)</CardTitle>
          <CardDescription>
            Ask another department a question on this project. Unanswered
            questions can be escalated up that department&apos;s seniority ladder.
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => setOpen((o) => !o)}>
          <Plus className="size-4" /> Ask a question
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-md border px-4 py-2 text-sm">
            {error}
          </div>
        )}

        {open && (
          <form onSubmit={submitNew} className="space-y-2 rounded-md border p-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <select
                className={cn(field, "sm:w-56")}
                value={toDept}
                onChange={(e) => setToDept(e.target.value)}
                aria-label="Ask which department"
              >
                <option value="">— ask which department —</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
              <Input
                placeholder="Subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="sm:flex-1"
                aria-label="Subject"
              />
            </div>
            <textarea
              placeholder="Your question…"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={2}
              className="border-input bg-background w-full rounded-md border px-2 py-1 text-sm"
              aria-label="Question"
            />
            <Button type="submit" size="sm" disabled={pending}>
              Send question
            </Button>
          </form>
        )}

        {rfis.length === 0 ? (
          <p className="text-muted-foreground text-sm">No questions yet.</p>
        ) : (
          <ul className="space-y-2">
            {rfis.map((r) => (
              <li key={r.id} className="rounded-md border">
                <button
                  type="button"
                  onClick={() => toggle(r.id)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{r.subject}</span>
                      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", STATUS_TONE[r.status])}>
                        {RFI_STATUS_LABEL[r.status]}
                      </span>
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {r.from_label ? `${r.from_label} → ` : ""}
                      {r.to_label}
                      {r.current_role_label && ` · with ${r.current_role_label}`}
                      {r.escalation_level > 0 && ` · escalated ×${r.escalation_level}`}
                    </div>
                  </div>
                  <span className="text-muted-foreground flex shrink-0 items-center gap-1 text-xs">
                    <MessageSquare className="size-3.5" /> {r.message_count}
                  </span>
                </button>

                {expanded === r.id && (
                  <div className="space-y-3 border-t px-3 py-3">
                    <div className="space-y-2">
                      {(threads[r.id] ?? []).length === 0 ? (
                        <p className="text-muted-foreground text-xs">No messages yet.</p>
                      ) : (
                        (threads[r.id] ?? []).map((m) => (
                          <div
                            key={m.id}
                            className={cn(
                              "rounded-md px-3 py-2 text-sm",
                              m.is_answer
                                ? "bg-blue-500/10 border-blue-500/30 border"
                                : "bg-muted"
                            )}
                          >
                            <div className="text-muted-foreground mb-0.5 flex items-center gap-2 text-[10px]">
                              <span className="font-medium">{m.author_name ?? "Someone"}</span>
                              {m.is_answer && <span className="text-blue-600">Answer</span>}
                            </div>
                            <p className="whitespace-pre-wrap">{m.body}</p>
                          </div>
                        ))
                      )}
                    </div>

                    {r.status !== "closed" && (
                      <div className="space-y-2">
                        <textarea
                          placeholder="Write a reply…"
                          value={reply}
                          onChange={(e) => setReply(e.target.value)}
                          rows={2}
                          className="border-input bg-background w-full rounded-md border px-2 py-1 text-sm"
                          aria-label="Reply"
                        />
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" disabled={pending} onClick={() => sendReply(r, false)}>
                            Reply
                          </Button>
                          {r.can_answer && (
                            <Button size="sm" disabled={pending} onClick={() => sendReply(r, true)}>
                              <CheckCircle2 className="size-4" /> Post as answer
                            </Button>
                          )}
                          <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => escalateRfi(projectId, r.id))}>
                            <ArrowUpCircle className="size-4" /> Escalate
                          </Button>
                          {r.can_manage && (
                            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => closeRfi(projectId, r.id))}>
                              <X className="size-4" /> Close
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
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
