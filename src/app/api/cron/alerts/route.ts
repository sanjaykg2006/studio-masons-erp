import { NextResponse } from "next/server";

import { cronAuthorized } from "@/core/alerts/cron-auth";
import { sendErrorAlerts } from "@/modules/errorlog/alerts";

export const dynamic = "force-dynamic";

/**
 * Called every 5 minutes by the database (pg_cron, 0105) while an error is
 * waiting to be emailed: sends it once the 15-minute gap since the last alert
 * has passed.
 */
export async function POST(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  const res = await sendErrorAlerts();
  return NextResponse.json(res, { status: "error" in res ? 500 : 200 });
}
