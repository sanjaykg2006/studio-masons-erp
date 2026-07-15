"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check } from "lucide-react";

import { logClientError } from "@/core/observability/log-error";
import { reportClientError, reportErrorNote } from "@/modules/errorlog/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Friendly crash screen for any page inside the app. Instead of a raw technical
 * error, the user sees a clear message and can retry or go back. The crash is
 * recorded to the Error Log automatically; the person can optionally add a
 * one-line "what I was doing", which gets attached to that same entry.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // The id of the logged crash, once recorded — lets us attach the user's note.
  const [logId, setLogId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");

  useEffect(() => {
    logClientError("app", error);
    // Persist to the in-app Error Log (best-effort; never rethrow), keeping the
    // row id so an optional user note can be attached to it.
    reportClientError({
      context: "app",
      message: error.message,
      digest: error.digest,
      detail: error.stack,
      path: typeof window !== "undefined" ? window.location.pathname : undefined,
    })
      .then((res) => setLogId(res.id))
      .catch(() => {});
  }, [error]);

  const sendNote = async () => {
    if (!logId || !note.trim()) return;
    setStatus("sending");
    try {
      await reportErrorNote(logId, note);
    } catch {
      // Best-effort — still thank the user rather than surface another error.
    }
    setStatus("sent");
  };

  return (
    <div className="mx-auto max-w-md py-12">
      <Card>
        <CardHeader>
          <div className="bg-destructive/10 text-destructive mb-2 flex size-10 items-center justify-center rounded-full">
            <AlertTriangle className="size-5" />
          </div>
          <CardTitle>Something went wrong</CardTitle>
          <CardDescription>
            This page hit an unexpected problem. It&apos;s not something you did.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground text-sm">
            Try again — if it keeps happening, please report it so we can fix it.
            {error.digest ? (
              <>
                {" "}
                Quote this reference:{" "}
                <span className="font-mono text-xs">{error.digest}</span>.
              </>
            ) : null}
          </p>

          {/* Optional user report — attached to the logged crash. */}
          {status === "sent" ? (
            <p className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-500">
              <Check className="size-4" /> Thanks — your note was sent to the team.
            </p>
          ) : (
            <div className="space-y-2">
              <label htmlFor="crash-note" className="text-muted-foreground text-sm">
                What were you doing when this happened? (optional)
              </label>
              <textarea
                id="crash-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                maxLength={1000}
                placeholder="e.g. I clicked Book invoice on PO SM-PO-0007"
                className="border-input bg-background w-full rounded-md border px-2 py-1.5 text-sm"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={sendNote}
                disabled={!logId || !note.trim() || status === "sending"}
              >
                {status === "sending" ? "Sending…" : "Send report"}
              </Button>
            </div>
          )}

          <div className="flex gap-2">
            <Button onClick={reset}>Try again</Button>
            <Button variant="outline" asChild>
              <Link href="/dashboard">Back to Dashboard</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
