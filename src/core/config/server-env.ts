import "server-only";

import { z } from "zod";

/**
 * Server-ONLY environment access.
 *
 * Separate from core/config/env.ts on purpose: these values are secrets that
 * must never reach the browser. `import "server-only"` makes the build fail
 * loudly if this module is ever pulled into client code.
 *
 * Validated lazily (on first use) rather than at import time, so a missing key
 * only breaks the specific server action that needs it — never the build or an
 * unrelated request.
 */
const serverEnvSchema = z.object({
  // The Supabase service_role key. Bypasses Row-Level Security, so it is used
  // only inside gated server actions (e.g. inviting/removing users). NEVER
  // prefix this with NEXT_PUBLIC_ and never read it in a client component.
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),
});

let cached: z.infer<typeof serverEnvSchema> | null = null;

export function serverEnv() {
  if (cached) return cached;

  const parsed = serverEnvSchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid or missing server environment variables:\n${issues}\n\n` +
        `Add SUPABASE_SERVICE_ROLE_KEY to .env.local — a server-only secret ` +
        `(Supabase dashboard -> Project Settings -> API -> service_role key). ` +
        `Never expose it to the browser.`
    );
  }

  cached = parsed.data;
  return cached;
}
