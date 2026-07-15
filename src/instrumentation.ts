import type { Instrumentation } from "next";

/**
 * Server-side error hook. Next.js calls this for EVERY unexpected error thrown
 * on the server — page/component renders, route handlers and Server Actions —
 * so backend failures land in the Error Log from one place, with no per-action
 * wiring. Client-only crashes are captured separately by the error boundaries.
 *
 * Kept best-effort and dynamically imported so a logging problem can never mask
 * the original error, and so this file stays light for the edge runtime.
 */
export const onRequestError: Instrumentation.onRequestError = async (
  err,
  request,
  context
) => {
  try {
    const { recordError } = await import("@/modules/errorlog/log");
    const e = err as Error & { digest?: string };
    await recordError({
      source: "server",
      context: `${context.routeType ?? "server"}${context.routePath ? ` ${context.routePath}` : ""}`,
      message: e?.message ?? String(err),
      digest: e?.digest ?? null,
      detail: e?.stack ?? null,
      path: request?.path ?? null,
    });
  } catch (loggingError) {
    console.error("[errorlog] onRequestError failed", loggingError);
  }
};
