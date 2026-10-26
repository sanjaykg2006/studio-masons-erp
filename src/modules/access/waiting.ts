/**
 * When a waiting approval needs someone's attention — pure, safe in client code.
 */

/** Waiting this many days or more counts as too long. */
export const STALE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days since `since`, never negative. */
export function daysWaiting(since: string, now: number = Date.now()): number {
  return Math.max(0, Math.floor((now - Date.parse(since)) / DAY_MS));
}

/** Nobody but an administrator override can give it, or it has waited too long. */
export function isStuck(
  w: { can_approve: string[]; waiting_since: string },
  now: number = Date.now()
): boolean {
  return w.can_approve.length === 0 || daysWaiting(w.waiting_since, now) >= STALE_DAYS;
}
