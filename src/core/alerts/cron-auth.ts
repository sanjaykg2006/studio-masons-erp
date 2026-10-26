import "server-only";

import { timingSafeEqual } from "node:crypto";

import { serverEnv } from "@/core/config/server-env";

/**
 * Whether a request to /api/cron/* carries the shared secret the database's
 * scheduled jobs send ("Authorization: Bearer <CRON_SECRET>"). Refuses
 * everything when no secret is configured.
 */
export function cronAuthorized(request: Request): boolean {
  const secret = serverEnv().CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
