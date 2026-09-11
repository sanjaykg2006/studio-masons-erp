/**
 * Projects domain types — the company-wide project world (projects, briefs,
 * members, controlled folders, stage progress). The Design department module
 * builds on these (a Design project is a project), so shared domain enums such
 * as Discipline and the stage vocabulary live here and Design imports them.
 *
 * NOTE: several types keep their historical `Design*` names to avoid a large
 * rename; they are project types regardless of the prefix.
 */

// --- Discipline (shared with Design templates) -------------------------------
export type Discipline = "interior" | "mep";

export const DISCIPLINE_LABEL: Record<Discipline, string> = {
  interior: "Interior Design",
  mep: "MEP",
};

// --- Controlled folders (per-user view) --------------------------------------

export type DesignFile = {
  id: string;
  project_id: string;
  folder_key: string;
  name: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  version_no: number;
  is_current: boolean;
  source_file_id: string | null;
  created_at: string;
};

/** A project folder as seen by the current user: their capability + lock state. */
export type ProjectFolder = {
  folder_key: string;
  label: string;
  sort: number;
  description: string | null;
  /** 0 none · 1 view · 2 edit · 3 approve. */
  rank: number;
  locked: boolean;
};

export type ChangeRequestStatus = "open" | "approved" | "rejected";

export const CHANGE_STATUS_LABEL: Record<ChangeRequestStatus, string> = {
  open: "Open",
  approved: "Approved",
  rejected: "Rejected",
};

export type DesignChangeRequest = {
  id: string;
  project_id: string;
  folder_key: string | null;
  title: string;
  reason: string | null;
  status: ChangeRequestStatus;
  raised_at: string;
  decided_at: string | null;
  decision_note: string | null;
  /** Its approval request (the flow's stages, snapshotted when raised). */
  approval_id: string | null;
  /** The approval stage it is waiting on, while open. */
  stage_label: string | null;
  /** The viewer may approve or reject that stage. */
  can_approve: boolean;
};

// --- Stage progress ----------------------------------------------------------

/** The five project stages from the governance framework, in order. */
export type DesignStage =
  | "brief_concept"
  | "client_review"
  | "design_freeze"
  | "gfc_release"
  | "site_execution";

export const DESIGN_STAGES: DesignStage[] = [
  "brief_concept",
  "client_review",
  "design_freeze",
  "gfc_release",
  "site_execution",
];

export const DESIGN_STAGE_LABEL: Record<DesignStage, string> = {
  brief_concept: "Brief & Concept",
  client_review: "Client Review",
  design_freeze: "Design Freeze",
  gfc_release: "GFC Release",
  site_execution: "Site Execution",
};

export type DesignStageStep = {
  id: string;
  stage: DesignStage;
  sort: number;
  label: string;
};

/** A checklist step plus whether this project has completed it. */
export type ProjectStep = DesignStageStep & { done: boolean };

/** One stage's checklist + its completion percentage (0–100). */
export type StageProgress = {
  stage: DesignStage;
  label: string;
  steps: ProjectStep[];
  pct: number;
};

/** A project's full progress: per-stage breakdown, the current stage, overall %. */
export type ProjectProgress = {
  stages: StageProgress[];
  /** First stage not yet 100% complete; the last stage once everything is done. */
  currentStage: DesignStage;
  /** 0–100, each stage weighted equally (20%), filling gradually within a stage. */
  overallPct: number;
};

// --- Project + brief ---------------------------------------------------------

export type ProjectStatus =
  | "draft"
  | "brief_in_progress"
  | "brief_approved"
  | "finalised";

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  draft: "Draft — not finalised",
  brief_in_progress: "Brief in progress",
  brief_approved: "Brief approved",
  finalised: "Finalised",
};

export type BriefStatus = "in_progress" | "in_review" | "approved";

export const BRIEF_STATUS_LABEL: Record<BriefStatus, string> = {
  in_progress: "In progress",
  in_review: "In review",
  approved: "Approved",
};

export type ProjectPhase = "concept" | "execution";

export const PROJECT_PHASE_LABEL: Record<ProjectPhase, string> = {
  concept: "Concept phase",
  execution: "Execution phase",
};

export type DesignProject = {
  id: string;
  code: string | null;
  name: string;
  client: string | null;
  location: string | null;
  status: ProjectStatus;
  phase: ProjectPhase;
  frozen_at: string | null;
  frozen_by: string | null;
  created_by: string | null;
  created_at: string;
  finalised_at: string | null;
};

export type DesignProjectMember = {
  project_id: string;
  user_id: string;
  role_id: string;
  added_at: string;
};

export type DesignBrief = {
  id: string;
  project_id: string;
  template_id: string;
  template_version_id: string;
  discipline: Discipline;
  status: BriefStatus;
  approved_at: string | null;
};

export type DesignBriefAnswer = {
  brief_id: string;
  question_id: string;
  values: Record<string, string>;
};
