/**
 * Design department domain types — the department-internal world: the
 * questionnaire template library and the controlled-folder ACCESS/CAPABILITY
 * settings. The project world (projects, briefs, files, stage progress) lives in
 * the Projects module; the shared Discipline enum is re-exported here for
 * convenience so Design screens can keep importing it from one place.
 */

import type { Discipline } from "@/modules/projects/types";

// The Discipline enum is shared with the project world (a brief has a
// discipline); re-exported here so Design templates can import it from one place.
export { DISCIPLINE_LABEL } from "@/modules/projects/types";
export type { Discipline } from "@/modules/projects/types";

export const DESIGN_RESOURCES = {
  project: "project",
  brief: "project.brief",
  template: "design.template",
  member: "project.member",
  folder: "design.folder",
} as const;

// --- Controlled folders: access/capability settings --------------------------

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

// --- Template library --------------------------------------------------------

export type TemplateStatus = "draft" | "published" | "archived";

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
