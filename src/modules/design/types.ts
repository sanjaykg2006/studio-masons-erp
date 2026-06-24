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
} as const;

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
