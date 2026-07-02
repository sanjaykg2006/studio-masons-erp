import "server-only";

import { createClient } from "@/core/supabase/server";
import type { Vendor } from "@/modules/procurement/types";

/** The vendor directory the caller can see (RLS-gated by procurement.vendor:read). */
export async function listVendors(): Promise<Vendor[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("list_vendors");
  return (data ?? []) as Vendor[];
}
