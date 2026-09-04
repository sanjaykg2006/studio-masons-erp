"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/core/supabase/client";

/** How often a focused tab quietly re-checks the server. */
const DEFAULT_INTERVAL_MS = 30_000;

/** Ignore a second refresh landing right on top of the first. */
const MIN_GAP_MS = 2_000;

/**
 * Keep the current page reasonably fresh without the user reloading.
 *
 * The ERP is server-rendered: your OWN actions re-render the page via
 * revalidatePath, but nothing tells you about a change someone ELSE made. This
 * is the baseline answer — a focused tab re-renders every 30s, and re-renders
 * immediately when you switch back to it, so no screen is ever badly stale.
 *
 * A hidden tab does nothing at all: no timer, no requests. The realtime hook
 * below is the instant version, used where staleness actually hurts.
 */
export function useAutoRefresh(intervalMs: number = DEFAULT_INTERVAL_MS) {
  const router = useRouter();
  const lastRef = useRef(0);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const refresh = () => {
      const now = Date.now();
      if (now - lastRef.current < MIN_GAP_MS) return;
      lastRef.current = now;
      router.refresh();
    };

    const start = () => {
      if (!timer) timer = setInterval(refresh, intervalMs);
    };
    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    // Coming back to the tab is the moment staleness is most likely and most
    // visible, so catch up straight away rather than waiting for the tick.
    const onWake = () => {
      if (document.visibilityState === "visible") {
        refresh();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
    };
  }, [router, intervalMs]);
}

/** One table to watch, with an optional Postgres-style filter. */
export type WatchedTable = {
  table: string;
  /** e.g. `project_id=eq.<uuid>`. Omit to watch every row you may read. */
  filter?: string;
};

/**
 * Re-render the page the moment someone else changes a row you can see.
 *
 * Used on the conversational screens (RFI threads, the task board) where
 * waiting up to 30 seconds is the wrong behaviour. Row-Level Security applies
 * to the stream exactly as it does to a query, so you are only ever told about
 * rows you were already allowed to read.
 *
 * @param channelName unique per screen+scope, e.g. `rfi:<projectId>`.
 * @param onChange extra work beyond the re-render — reloading client-held state
 *        that a server re-render would not touch (an expanded RFI thread).
 */
export function useRealtimeRefresh(
  channelName: string,
  tables: WatchedTable[],
  onChange?: () => void
) {
  const router = useRouter();
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Serialised so a fresh array literal on every render doesn't resubscribe.
  const key = JSON.stringify(tables);

  useEffect(() => {
    const watched = JSON.parse(key) as WatchedTable[];
    if (!watched.length) return;

    let cancelled = false;
    const supabase = createClient();
    const channel = supabase.channel(channelName);

    for (const { table, filter } of watched) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table, ...(filter ? { filter } : {}) },
        () => {
          router.refresh();
          onChangeRef.current?.();
        }
      );
    }

    // The realtime socket authenticates separately from the REST client. Hand
    // it the session token BEFORE subscribing, or the server has no identity to
    // evaluate the RLS policies against and simply sends nothing.
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session?.access_token) {
        await supabase.realtime.setAuth(data.session.access_token);
      }
      if (!cancelled) channel.subscribe();
    })();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [channelName, key, router]);
}
