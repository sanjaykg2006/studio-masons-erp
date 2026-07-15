"use server";

import { attachErrorNote, recordError } from "@/modules/errorlog/log";

/**
 * Persist a crash caught by a React error boundary (client-side).
 *
 * Called from the crash screens (error.tsx / global-error.tsx). Writing goes
 * through the service role inside recordError, so no table grant is needed on
 * the caller. Best-effort by design — never throws back at the boundary.
 *
 * Note: in production Next replaces the client error's message with a generic
 * one and keeps only `digest`; the matching server-side row (captured by
 * instrumentation) carries the real message, correlated by that same digest.
 */
export async function reportClientError(input: {
  context: string;
  message: string;
  digest?: string;
  detail?: string;
  path?: string;
}): Promise<{ id: string | null }> {
  const id = await recordError({
    source: "client",
    context: input.context,
    message: input.message,
    digest: input.digest ?? null,
    detail: input.detail ?? null,
    path: input.path ?? null,
  });
  return { id };
}

/**
 * Attach the user's optional "what I was doing" note to a crash already logged
 * by reportClientError. Best-effort — the crash screen never blocks on it.
 */
export async function reportErrorNote(id: string, note: string): Promise<void> {
  await attachErrorNote(id, note);
}
