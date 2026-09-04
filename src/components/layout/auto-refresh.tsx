"use client";

import { useAutoRefresh } from "@/core/hooks/use-live-refresh";

/**
 * Mounted once in the app shell: keeps whatever page you are on from going
 * stale while you sit on it. Renders nothing.
 */
export function AutoRefresh() {
  useAutoRefresh();
  return null;
}
