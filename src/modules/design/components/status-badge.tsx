import { cn } from "@/lib/utils";
import {
  BRIEF_STATUS_LABEL,
  PROJECT_PHASE_LABEL,
  PROJECT_STATUS_LABEL,
  type BriefStatus,
  type ProjectPhase,
  type ProjectStatus,
} from "@/modules/projects/types";

const PROJECT_TONE: Record<ProjectStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  brief_in_progress: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  brief_approved: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  finalised: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
};

const BRIEF_TONE: Record<BriefStatus, string> = {
  in_progress: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  in_review: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  approved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
};

const PHASE_TONE: Record<ProjectPhase, string> = {
  concept: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-400",
  execution: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
};

const base =
  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium";

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return <span className={cn(base, PROJECT_TONE[status])}>{PROJECT_STATUS_LABEL[status]}</span>;
}

export function BriefStatusBadge({ status }: { status: BriefStatus }) {
  return <span className={cn(base, BRIEF_TONE[status])}>{BRIEF_STATUS_LABEL[status]}</span>;
}

export function ProjectPhaseBadge({ phase }: { phase: ProjectPhase }) {
  return <span className={cn(base, PHASE_TONE[phase])}>{PROJECT_PHASE_LABEL[phase]}</span>;
}
