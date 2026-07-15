"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { logClientError } from "@/core/observability/log-error";
import { reportClientError } from "@/modules/errorlog/actions";
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
 * error, the user sees a clear message and can retry or go back. The error is
 * logged (see log-error) so it surfaces in the host's logs during testing.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logClientError("app", error);
    // Also persist to the in-app Error Log (best-effort; never rethrow).
    void reportClientError({
      context: "app",
      message: error.message,
      digest: error.digest,
      detail: error.stack,
      path: typeof window !== "undefined" ? window.location.pathname : undefined,
    }).catch(() => {});
  }, [error]);

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
        <CardContent className="space-y-3">
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
