import "server-only";

import { isUnexpectedFailure } from "@/core/supabase/failure";

/**
 * fetch for the server's Supabase client that records UNEXPECTED database
 * failures in the Error Log (which emails IT). Screens turn a failed save into
 * a polite message, so without this a broken database function would only ever
 * be found by the person who hit it. Ordinary refusals are left alone — see
 * failure.ts. The reply itself is passed through untouched.
 */
export const watchedFetch: typeof fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch (err) {
    if (!url.pathname.startsWith("/auth/v1/")) {
      await report(`Could not reach the database: ${err instanceof Error ? err.message : String(err)}`, method, url);
    }
    throw err;
  }
  if (res.status >= 400 && !url.pathname.startsWith("/auth/v1/")) {
    const body = (await res
      .clone()
      .json()
      .catch(() => null)) as { code?: string; message?: string } | null;
    if (isUnexpectedFailure(url.pathname, res.status, body?.code)) {
      await report(
        `${body?.code ? `${body.code}: ` : ""}${body?.message ?? `HTTP ${res.status}`}`,
        method,
        url
      );
    }
  }
  return res;
};

async function report(message: string, method: string, url: URL) {
  try {
    const { recordError } = await import("@/modules/errorlog/log");
    await recordError({
      source: "server",
      context: "database call",
      message,
      // Path only: query strings can carry ids and filter values.
      detail: `${method} ${url.pathname}`,
    });
  } catch (err) {
    console.error("[errorlog] could not record a database failure", err);
  }
}
