import "server-only";

import { createClient } from "@supabase/supabase-js";

import { env } from "@/core/config/env";
import { serverEnv } from "@/core/config/server-env";

/**
 * Privileged Supabase client backed by the service_role key.
 *
 * DANGER: this client BYPASSES Row-Level Security. Use it only inside server
 * actions that have already checked permissions (e.g. requirePermission), and
 * never expose it or its key to the browser. For all normal request work, use
 * core/supabase/server.ts (the RLS-respecting client) instead.
 *
 * Needed for admin operations the anon key cannot do — creating/inviting and
 * deleting auth users.
 */
export function createAdminClient() {
  return createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv().SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
