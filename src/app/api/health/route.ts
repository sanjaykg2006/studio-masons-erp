import { NextResponse } from "next/server";

import { createAdminClient } from "@/core/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Health check for the outside uptime monitor (UptimeRobot). 200 when the
 * website AND the database answer, 503 otherwise — so "site or database down"
 * is caught even when the database can't record anything itself. Public, and
 * says nothing beyond up/down.
 */
export async function GET() {
  const started = Date.now();
  try {
    const { error } = await createAdminClient()
      .from("approval_flows")
      .select("id")
      .limit(1)
      .abortSignal(AbortSignal.timeout(8000));
    if (error) throw error;
    return NextResponse.json(
      { status: "ok", ms: Date.now() - started },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json(
      { status: "database unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
