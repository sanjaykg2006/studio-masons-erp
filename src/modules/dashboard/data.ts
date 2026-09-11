import "server-only";

import { createClient } from "@/core/supabase/server";
import { can } from "@/core/rbac/can";
import { getFinanceSummary } from "@/modules/finance/data";
import { listProjects } from "@/modules/projects/data";
import {
  DESIGN_STAGES,
  DESIGN_STAGE_LABEL,
  type DesignProject,
  type DesignStage,
} from "@/modules/projects/types";

/** How many project cards the dashboard shows before linking to the full list. */
const MAX_CARDS = 6;

/** A project enriched with its overall progress and current stage, for a card. */
export type DashboardProject = DesignProject & {
  /** 0–100, each of the 5 stages weighted equally (mirrors getProjectProgress). */
  overallPct: number;
  /** First stage not yet 100% complete; the last stage once all are done. */
  currentStageLabel: string;
};

/** The company money numbers shown when the viewer may see finance. */
export type DashboardFinance = {
  totalOwed: number;
  paidThisMonth: number;
  advancesUnpaid: number;
};

export type DashboardData = {
  /** Best available display name for the greeting. */
  name: string | null;
  totalProjects: number;
  activeProjects: number;
  /** Least-progressed first, capped at MAX_CARDS. */
  projects: DashboardProject[];
  /** True when more projects exist than the cards show (render "View all"). */
  hasMore: boolean;
  /** Present only when the viewer has finance.invoice:read. */
  finance: DashboardFinance | null;
};

/**
 * Everything the dashboard renders, in a fixed, small number of queries.
 *
 * Progress is computed for ALL accessible projects at once (all stage steps in
 * one read, all completed steps in one `.in(...)` read) so the page cost stays
 * flat no matter how many projects the viewer can see — then we sort by
 * least-progressed and keep the top few for cards.
 */
export async function getDashboardData(userId: string): Promise<DashboardData> {
  const supabase = await createClient();

  // Name for the greeting + the RLS-scoped project list, in parallel.
  const [{ data: profile }, projects] = await Promise.all([
    supabase.from("profiles").select("full_name, email").eq("id", userId).maybeSingle(),
    listProjects(),
  ]);

  const enriched = await withProgress(projects);
  // Least-progressed first; ties keep the newest-first order from listProjects.
  enriched.sort((a, b) => a.overallPct - b.overallPct);

  const totalProjects = projects.length;
  const activeProjects = projects.filter((p) => p.status !== "finalised").length;

  const finance = (await can("finance.invoice", "read"))
    ? await getFinance()
    : null;

  return {
    name: (profile?.full_name || profile?.email) ?? null,
    totalProjects,
    activeProjects,
    projects: enriched.slice(0, MAX_CARDS),
    hasMore: totalProjects > MAX_CARDS,
    finance,
  };
}

/** Attach overallPct + currentStageLabel to each project (2 batched queries). */
async function withProgress(projects: DesignProject[]): Promise<DashboardProject[]> {
  if (projects.length === 0) return [];
  const supabase = await createClient();
  const ids = projects.map((p) => p.id);

  // Each project carries its own checklist, so the denominator is per project
  // now rather than one shared list of steps.
  const { data: rows } = await supabase
    .from("project_steps")
    .select("project_id, stage, done")
    .in("project_id", ids);

  // project id -> stage -> [total, done]
  const tally = new Map<string, Map<DesignStage, [number, number]>>();
  for (const r of (rows ?? []) as {
    project_id: string;
    stage: DesignStage;
    done: boolean;
  }[]) {
    if (!tally.has(r.project_id)) tally.set(r.project_id, new Map());
    const byStage = tally.get(r.project_id)!;
    const cur = byStage.get(r.stage) ?? [0, 0];
    cur[0] += 1;
    if (r.done) cur[1] += 1;
    byStage.set(r.stage, cur);
  }

  return projects.map((p) => {
    const byStage = tally.get(p.id) ?? new Map<DesignStage, [number, number]>();

    // Per-stage %, each stage weighted equally in the overall figure.
    const stagePcts = DESIGN_STAGES.map((stage) => {
      const [total, done] = byStage.get(stage) ?? [0, 0];
      return { stage, pct: total === 0 ? 0 : Math.round((done / total) * 100) };
    });

    const overallPct = Math.round(
      stagePcts.reduce((sum, s) => sum + s.pct, 0) / stagePcts.length
    );
    const current = stagePcts.find((s) => s.pct < 100) ?? stagePcts[stagePcts.length - 1];

    return {
      ...p,
      overallPct,
      currentStageLabel: DESIGN_STAGE_LABEL[current.stage],
    };
  });
}

/** Company-wide money snapshot (RLS-gated) — just the three tiles we show. */
async function getFinance(): Promise<DashboardFinance> {
  const s = await getFinanceSummary();
  return {
    totalOwed: s.total_owed,
    paidThisMonth: s.paid_this_month,
    advancesUnpaid: s.advances_unpaid,
  };
}
