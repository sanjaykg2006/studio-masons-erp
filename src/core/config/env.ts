import { z } from "zod";

/**
 * Centralized, validated environment access.
 *
 * Every env var the app needs is declared here once. If one is missing or
 * malformed, the app fails LOUDLY at startup with a clear message instead of
 * breaking mysteriously deep inside a request.
 *
 * Only NEXT_PUBLIC_* vars are safe to read in the browser. Never add secrets
 * (e.g. the Supabase service_role key) to this client schema.
 */
const clientEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .url("NEXT_PUBLIC_SUPABASE_URL must be a valid URL"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(1, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required"),
  // Canonical public origin for auth redirect links. Optional: when unset, the
  // server derives the origin from the incoming request host instead.
  NEXT_PUBLIC_SITE_URL: z
    .string()
    .url("NEXT_PUBLIC_SITE_URL must be a valid URL")
    .optional(),
});

// Reference each var explicitly so Next.js inlines them at build time.
const parsed = clientEnvSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
});

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(
    `Invalid or missing environment variables:\n${issues}\n\n` +
      `Copy .env.example to .env.local and fill in your Supabase credentials.`
  );
}

export const env = parsed.data;
