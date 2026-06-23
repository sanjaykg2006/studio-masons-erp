import { createBrowserClient } from "@supabase/ssr";

import { env } from "@/core/config/env";

/**
 * Supabase client for use in Client Components ("use client").
 * Reads/writes the auth session from browser cookies.
 */
export function createClient() {
  return createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}
