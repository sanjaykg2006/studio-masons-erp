import "server-only";

import { createClient } from "@/core/supabase/server";
import type { ModuleHome } from "@/core/modules/registry";

/**
 * The stored "where is it set" choice for each module (module_settings.home),
 * edited on Access Control. Pair with `effectiveHome`, which falls back to the
 * resource's default when nothing valid is stored. RLS lets access admins and
 * anyone running a department read it.
 */
export async function getStoredHomes(): Promise<Map<string, ModuleHome>> {
  const supabase = await createClient();
  const { data } = await supabase.from("module_settings").select("module_id, home");
  return new Map(
    ((data ?? []) as { module_id: string; home: ModuleHome | null }[])
      .filter((s) => s.home)
      .map((s) => [s.module_id, s.home as ModuleHome])
  );
}
