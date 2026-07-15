import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { inr } from "@/modules/finance/types";
import {
  ProjectPhaseBadge,
  ProjectStatusBadge,
} from "@/modules/projects/components/status-badge";
import type { DashboardData, DashboardProject } from "@/modules/dashboard/data";

/**
 * Presentational view for the dashboard. All data (name, counts, per-project
 * progress, finance) is loaded by the page and passed in — this stays a pure
 * Server Component with no data access of its own.
 */
export function DashboardView({ data }: { data: DashboardData }) {
  const { name, totalProjects, activeProjects, projects, hasMore, finance } = data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {greeting()}
          {name ? `, ${name.split(" ")[0]}` : ""}
        </h1>
        <p className="text-muted-foreground">
          {summaryLine(totalProjects, activeProjects)}
        </p>
      </div>

      {/* KPI tiles */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Projects" hint={`${activeProjects} active`}>
          {totalProjects}
        </StatCard>
        {finance && (
          <>
            <StatCard label="Outstanding to vendors" hint="Across all projects">
              {inr(finance.totalOwed)}
            </StatCard>
            <StatCard label="Paid this month" hint="Vendor payments">
              {inr(finance.paidThisMonth)}
            </StatCard>
            <StatCard label="Unpaid advances" hint="Approved, not released">
              {inr(finance.advancesUnpaid)}
            </StatCard>
          </>
        )}
      </div>

      {/* Projects overview */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Projects overview</h2>
          {hasMore && (
            <Button asChild size="sm" variant="outline">
              <Link href="/projects">View all</Link>
            </Button>
          )}
        </div>

        {projects.length === 0 ? (
          <Card>
            <CardContent className="text-muted-foreground py-8 text-center text-sm">
              No projects to show yet.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** One KPI tile: big value with a label and a small hint. */
function StatCard({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold">{children}</div>
        <p className="text-muted-foreground mt-1 text-xs">{hint}</p>
      </CardContent>
    </Card>
  );
}

/** A project tile: identity, badges, progress bar, and current stage. */
function ProjectCard({ project }: { project: DashboardProject }) {
  const subtitle = [project.client, project.location].filter(Boolean).join(" · ");
  return (
    <Link href={`/projects/${project.id}`} className="group block">
      <Card className="hover:border-primary/40 h-full transition-colors">
        <CardHeader className="pb-3">
          <CardTitle className="text-base group-hover:underline">
            {project.name}
          </CardTitle>
          <CardDescription>{subtitle || "—"}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <ProjectPhaseBadge phase={project.phase} />
            <ProjectStatusBadge status={project.status} />
          </div>
          <ProgressBar pct={project.overallPct} />
          <div className="text-muted-foreground flex items-center justify-between text-xs">
            <span>Now: {project.currentStageLabel}</span>
            <span className="font-medium">{project.overallPct}%</span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

/** Slim completion bar (0–100%). */
function ProgressBar({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div
      className="bg-muted h-2 w-full overflow-hidden rounded-full"
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="bg-primary h-full rounded-full transition-all"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

/** Time-of-day greeting, computed on the server. */
function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/** One-line status under the greeting. */
function summaryLine(total: number, active: number): string {
  if (total === 0) return "No projects yet — create one to get started.";
  const p = total === 1 ? "project" : "projects";
  return `${total} ${p} · ${active} active. Here's where they stand.`;
}
