/**
 * Design Department domain types. These mirror the tables in
 * supabase/migrations/0006_design_department.sql. Permissions for this module
 * use the four sub-resources: design.project / design.brief / design.template /
 * design.member (see DESIGN_RESOURCES).
 */

export const DESIGN_RESOURCES = {
  project: "design.project",
  brief: "design.brief",
  template: "design.template",
  member: "design.member",
  folder: "design.folder",
} as const;

// --- Controlled folders ------------------------------------------------------

/** A capability is the HIGHEST level a role holds on a folder. approve ⊃ edit ⊃ view. */
export type FolderCapability = "view" | "edit" | "approve";

export const FOLDER_CAPABILITY_LABEL: Record<FolderCapability, string> = {
  view: "View",
  edit: "Edit",
  approve: "Approve",
};

/** Ordered for the access editor's cycle: none → view → edit → approve → none. */
export const FOLDER_CAPABILITY_ORDER: (FolderCapability | null)[] = [
  null,
  "view",
  "edit",
  "approve",
];

export type DesignFolderType = {
  key: string;
  label: string;
  sort: number;
  description: string | null;
};

export type DesignFolderAccess = {
  folder_key: string;
  role_id: string;
  capability: FolderCapability;
};

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

export type Discipline = "interior" | "mep";

export const DISCIPLINE_LABEL: Record<Discipline, string> = {
  interior: "Interior Design",
  mep: "MEP",
};

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

export type TemplateStatus = "draft" | "published" | "archived";

export type DesignProject = {
  id: string;
  code: string | null;
  name: string;
  client: string | null;
  location: string | null;
  status: ProjectStatus;
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

export type TemplateColumnKind = "text" | "longtext" | "yes_no" | "option";

export type DesignTemplate = {
  id: string;
  key: string;
  label: string;
  discipline: Discipline;
  is_active: boolean;
};

export type DesignTemplateVersion = {
  id: string;
  template_id: string;
  version_no: number;
  status: TemplateStatus;
  created_at: string;
};

export type DesignTemplateColumn = {
  id: string;
  version_id: string;
  sort: number;
  key: string;
  label: string;
  kind: TemplateColumnKind;
};

export type DesignTemplateSection = {
  id: string;
  version_id: string;
  sort: number;
  title: string;
};

export type DesignTemplateQuestion = {
  id: string;
  section_id: string;
  sort: number;
  text: string;
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
