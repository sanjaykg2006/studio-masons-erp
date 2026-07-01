import "server-only";

import { createClient } from "@/core/supabase/server";
import { getProjectPermissions } from "@/core/rbac/permissions";
import { permissionKey, type Action, type PermissionKey } from "@/core/rbac/types";
import type { BriefPdfData } from "@/modules/design/brief-pdf";
import { DISCIPLINE_LABEL } from "@/modules/design/types";
import {
  DESIGN_STAGES,
  DESIGN_STAGE_LABEL,
  type BriefStatus,
  type DesignBrief,
  type DesignChangeRequest,
  type DesignFile,
  type DesignFolderAccess,
  type DesignFolderType,
  type DesignProject,
  type DesignStage,
  type DesignStageStep,
  type FolderCapability,
  type ProjectFolder,
  type ProjectStep,
  type DesignTemplate,
  type DesignTemplateColumn,
  type DesignTemplateQuestion,
  type DesignTemplateSection,
  type DesignTemplateVersion,
  type Discipline,
  type ProjectProgress,
  type ProjectStatus,
  type StageProgress,
  type TemplateStatus,
} from "@/modules/design/types";

// --- Templates ---------------------------------------------------------------

export type TemplateSummary = DesignTemplate & {
  publishedVersion: number | null;
  hasDraft: boolean;
};

/**
 * All templates with their version state, for a library page. `scope` selects the
 * library: "general" = company-wide templates (Projects, department_id NULL);
 * "design" = the Design department's own (department_id = Design).
 */
export async function listTemplates(
  scope: "general" | "design"
): Promise<TemplateSummary[]> {
  const supabase = await createClient();
  let templatesQuery = supabase
    .from("design_templates")
    .select("id, key, label, discipline, is_active, department_id")
    .order("label");
  if (scope === "general") {
    templatesQuery = templatesQuery.is("department_id", null);
  } else {
    const { data: dept } = await supabase
      .from("departments")
      .select("id")
      .eq("key", "design")
      .maybeSingle();
    templatesQuery = templatesQuery.eq(
      "department_id",
      dept?.id ?? "00000000-0000-0000-0000-000000000000"
    );
  }
  const [{ data: templates }, { data: versions }] = await Promise.all([
    templatesQuery,
    supabase
      .from("design_template_versions")
      .select("id, template_id, version_no, status"),
  ]);

  const vById = new Map<string, { version_no: number; status: TemplateStatus }[]>();
  for (const v of (versions ?? []) as {
    template_id: string;
    version_no: number;
    status: TemplateStatus;
  }[]) {
    if (!vById.has(v.template_id)) vById.set(v.template_id, []);
    vById.get(v.template_id)!.push({ version_no: v.version_no, status: v.status });
  }

  return ((templates ?? []) as DesignTemplate[]).map((t) => {
    const vs = vById.get(t.id) ?? [];
    const published = vs
      .filter((v) => v.status === "published")
      .map((v) => v.version_no);
    return {
      ...t,
      publishedVersion: published.length ? Math.max(...published) : null,
      hasDraft: vs.some((v) => v.status === "draft"),
    };
  });
}

export type TemplateTree = {
  template: DesignTemplate;
  version: DesignTemplateVersion;
  columns: DesignTemplateColumn[];
  sections: (DesignTemplateSection & { questions: DesignTemplateQuestion[] })[];
};

/** Load one version's full structure (columns + sections + questions). */
async function loadVersionTree(
  versionId: string
): Promise<TemplateTree | null> {
  const supabase = await createClient();
  const { data: version } = await supabase
    .from("design_template_versions")
    .select("id, template_id, version_no, status, created_at")
    .eq("id", versionId)
    .maybeSingle();
  if (!version) return null;

  const [{ data: template }, { data: columns }, { data: sections }] =
    await Promise.all([
      supabase
        .from("design_templates")
        .select("id, key, label, discipline, is_active")
        .eq("id", version.template_id)
        .single(),
      supabase
        .from("design_template_columns")
        .select("id, version_id, sort, key, label, kind")
        .eq("version_id", versionId)
        .order("sort"),
      supabase
        .from("design_template_sections")
        .select("id, version_id, sort, title")
        .eq("version_id", versionId)
        .order("sort"),
    ]);

  const sectionIds = (sections ?? []).map((s) => s.id);
  const { data: questions } = sectionIds.length
    ? await supabase
        .from("design_template_questions")
        .select("id, section_id, sort, text")
        .in("section_id", sectionIds)
        .order("sort")
    : { data: [] as DesignTemplateQuestion[] };

  const qBySection = new Map<string, DesignTemplateQuestion[]>();
  for (const q of (questions ?? []) as DesignTemplateQuestion[]) {
    if (!qBySection.has(q.section_id)) qBySection.set(q.section_id, []);
    qBySection.get(q.section_id)!.push(q);
  }

  return {
    template: template as DesignTemplate,
    version: version as DesignTemplateVersion,
    columns: (columns ?? []) as DesignTemplateColumn[],
    sections: ((sections ?? []) as DesignTemplateSection[]).map((s) => ({
      ...s,
      questions: qBySection.get(s.id) ?? [],
    })),
  };
}

/** The version to show in the editor: the draft if one exists, else the latest. */
export async function getEditableTemplate(
  templateId: string
): Promise<TemplateTree | null> {
  const supabase = await createClient();
  const { data: versions } = await supabase
    .from("design_template_versions")
    .select("id, version_no, status")
    .eq("template_id", templateId)
    .order("version_no", { ascending: false });

  if (!versions?.length) return null;
  const draft = versions.find((v) => v.status === "draft");
  return loadVersionTree(draft?.id ?? versions[0].id);
}

// --- Projects ----------------------------------------------------------------

/** Projects the user can see (RLS scopes to membership / department-wide). */
export async function listProjects(): Promise<DesignProject[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select(
      "id, code, name, client, location, status, created_by, created_at, finalised_at"
    )
    .order("created_at", { ascending: false });
  return (data ?? []) as DesignProject[];
}

export type ProjectMemberView = {
  user_id: string;
  full_name: string | null;
  email: string | null;
  role_id: string;
};

export type ProjectBriefRow = DesignBrief & { template_label: string };

export type ProjectDetail = {
  project: DesignProject;
  members: ProjectMemberView[];
  briefs: ProjectBriefRow[];
  /** The caller's effective permission keys on this project (for UI gating). */
  permissions: PermissionKey[];
  can: (resource: string, action: string) => boolean;
};

/** Everything the project page renders, plus the caller's per-project grants. */
export async function getProjectDetail(
  projectId: string
): Promise<ProjectDetail | null> {
  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select(
      "id, code, name, client, location, status, created_by, created_at, finalised_at"
    )
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return null;

  const [membersRes, briefsRes, permSet] = await Promise.all([
    supabase.rpc("design_project_members_view", { p_project: projectId }),
    supabase
      .from("project_briefs")
      .select(
        "id, project_id, template_id, template_version_id, discipline, status, approved_at, design_templates(label)"
      )
      .eq("project_id", projectId),
    getProjectPermissions(projectId),
  ]);

  const briefs: ProjectBriefRow[] = (
    (briefsRes.data ?? []) as unknown as (DesignBrief & {
      design_templates: { label: string } | null;
    })[]
  ).map((b) => ({
    id: b.id,
    project_id: b.project_id,
    template_id: b.template_id,
    template_version_id: b.template_version_id,
    discipline: b.discipline,
    status: b.status,
    approved_at: b.approved_at,
    template_label: b.design_templates?.label ?? "Brief",
  }));

  const permissions = [...permSet];
  return {
    project: project as DesignProject,
    members: (membersRes.data ?? []) as ProjectMemberView[],
    briefs,
    permissions,
    can: (resource, action) =>
      permSet.has(permissionKey(resource, action as never)) ||
      permSet.has(permissionKey("*", action as never)),
  };
}

// --- Brief -------------------------------------------------------------------

export type BriefDetail = {
  brief: DesignBrief;
  project: Pick<DesignProject, "id" | "name" | "status">;
  tree: TemplateTree;
  answers: Record<string, Record<string, string>>; // question_id -> { col: value }
  canEdit: boolean;
  canReview: boolean;
  canApprove: boolean;
};

/** A brief with its questionnaire tree, current answers, and the caller's verbs. */
export async function getBriefDetail(
  briefId: string
): Promise<BriefDetail | null> {
  const supabase = await createClient();
  const { data: brief } = await supabase
    .from("project_briefs")
    .select(
      "id, project_id, template_id, template_version_id, discipline, status, approved_at"
    )
    .eq("id", briefId)
    .maybeSingle();
  if (!brief) return null;

  const [{ data: project }, tree, { data: answerRows }, permSet] =
    await Promise.all([
      supabase
        .from("projects")
        .select("id, name, status")
        .eq("id", brief.project_id)
        .single(),
      loadVersionTree(brief.template_version_id),
      supabase
        .from("project_brief_answers")
        .select("question_id, values")
        .eq("brief_id", briefId),
      getProjectPermissions(brief.project_id),
    ]);
  if (!tree || !project) return null;

  const answers: Record<string, Record<string, string>> = {};
  for (const row of (answerRows ?? []) as {
    question_id: string;
    values: Record<string, string>;
  }[]) {
    answers[row.question_id] = row.values ?? {};
  }

  const has = (action: string) =>
    permSet.has(permissionKey("project.brief", action as never)) ||
    permSet.has(permissionKey("*", action as never));

  return {
    brief: brief as DesignBrief,
    project: project as Pick<DesignProject, "id" | "name" | "status">,
    tree,
    answers,
    canEdit: has("update") && (brief.status as BriefStatus) !== "approved",
    canReview: has("review"),
    canApprove: has("approve"),
  };
}

/** Everything needed to render an approved brief as an archived PDF. */
export async function getBriefForPdf(
  briefId: string
): Promise<BriefPdfData | null> {
  const supabase = await createClient();
  const { data: brief } = await supabase
    .from("project_briefs")
    .select("project_id, template_id, template_version_id, discipline, approved_at")
    .eq("id", briefId)
    .maybeSingle();
  if (!brief) return null;

  const [{ data: project }, tree, { data: answerRows }] = await Promise.all([
    supabase.from("projects").select("name").eq("id", brief.project_id).single(),
    loadVersionTree(brief.template_version_id),
    supabase.from("project_brief_answers").select("question_id, values").eq("brief_id", briefId),
  ]);
  if (!tree || !project) return null;

  const answers: Record<string, Record<string, string>> = {};
  for (const row of (answerRows ?? []) as {
    question_id: string;
    values: Record<string, string>;
  }[]) {
    answers[row.question_id] = row.values ?? {};
  }

  return {
    projectName: project.name,
    templateLabel: tree.template.label,
    disciplineLabel: DISCIPLINE_LABEL[brief.discipline as keyof typeof DISCIPLINE_LABEL],
    versionNo: tree.version.version_no,
    approvedAt: brief.approved_at,
    columns: tree.columns.map((c) => ({ key: c.key, label: c.label })),
    sections: tree.sections.map((s) => ({
      title: s.title,
      questions: s.questions.map((q) => ({ id: q.id, text: q.text })),
    })),
    answers,
  };
}

// --- Pickers (for create-project / add-member / new-brief) -------------------

export type AssignableUser = { id: string; full_name: string | null; email: string | null };
export type DesignRole = { id: string; label: string };

export async function getMembershipPickers(): Promise<{
  users: AssignableUser[];
  roles: DesignRole[];
}> {
  const supabase = await createClient();
  const [usersRes, rolesRes] = await Promise.all([
    supabase.rpc("design_assignable_users"),
    supabase.rpc("design_roles"),
  ]);
  return {
    users: (usersRes.data ?? []) as AssignableUser[],
    roles: (rolesRes.data ?? []) as DesignRole[],
  };
}

/** Active templates with a published version — the choices when starting a brief. */
export async function getPublishableTemplates(): Promise<
  { id: string; label: string; discipline: Discipline; version_id: string }[]
> {
  const supabase = await createClient();
  const { data: versions } = await supabase
    .from("design_template_versions")
    .select("id, template_id, version_no, status, design_templates(label, discipline, is_active, department_id)")
    .eq("status", "published");

  const best = new Map<
    string,
    { id: string; label: string; discipline: Discipline; version_no: number }
  >();
  for (const v of (versions ?? []) as unknown as {
    id: string;
    template_id: string;
    version_no: number;
    design_templates: {
      label: string;
      discipline: Discipline;
      is_active: boolean;
      department_id: string | null;
    } | null;
  }[]) {
    if (!v.design_templates?.is_active) continue;
    // Briefs are built from GENERAL templates (Projects), not a department's own.
    if (v.design_templates.department_id !== null) continue;
    const prev = best.get(v.template_id);
    if (!prev || v.version_no > prev.version_no) {
      best.set(v.template_id, {
        id: v.template_id,
        label: v.design_templates.label,
        discipline: v.design_templates.discipline,
        version_no: v.version_no,
      });
    }
  }
  // Map back to include the winning version id.
  const result: { id: string; label: string; discipline: Discipline; version_id: string }[] = [];
  for (const [templateId, info] of best) {
    const versionId = ((versions ?? []) as { id: string; template_id: string; version_no: number }[])
      .find((v) => v.template_id === templateId && v.version_no === info.version_no)?.id;
    if (versionId) result.push({ id: info.id, label: info.label, discipline: info.discipline, version_id: versionId });
  }
  return result.sort((a, b) => a.label.localeCompare(b.label));
}

// --- Stage progress ----------------------------------------------------------

/** A project's checklist progress: per-stage %, the current stage, and overall %. */
export async function getProjectProgress(
  projectId: string
): Promise<ProjectProgress> {
  const supabase = await createClient();
  const [{ data: steps }, { data: done }] = await Promise.all([
    supabase.from("design_stage_steps").select("id, stage, sort, label").order("sort"),
    supabase.from("project_steps").select("step_id, done").eq("project_id", projectId),
  ]);

  const doneSet = new Set(
    ((done ?? []) as { step_id: string; done: boolean }[])
      .filter((d) => d.done)
      .map((d) => d.step_id)
  );

  const byStage = new Map<DesignStage, ProjectStep[]>();
  for (const s of (steps ?? []) as DesignStageStep[]) {
    if (!byStage.has(s.stage)) byStage.set(s.stage, []);
    byStage.get(s.stage)!.push({ ...s, done: doneSet.has(s.id) });
  }

  const stages: StageProgress[] = DESIGN_STAGES.map((stage) => {
    const stageSteps = (byStage.get(stage) ?? []).sort((a, b) => a.sort - b.sort);
    const total = stageSteps.length;
    const completed = stageSteps.filter((s) => s.done).length;
    return {
      stage,
      label: DESIGN_STAGE_LABEL[stage],
      steps: stageSteps,
      pct: total === 0 ? 0 : Math.round((completed / total) * 100),
    };
  });

  // Current stage = first stage not yet fully complete; the last once all done.
  const current = stages.find((s) => s.pct < 100) ?? stages[stages.length - 1];
  // Overall = each stage weighted equally (20%), filling gradually within a stage.
  const overallPct = Math.round(
    stages.reduce((sum, s) => sum + s.pct, 0) / stages.length
  );

  return { stages, currentStage: current.stage, overallPct };
}

// --- Controlled folders (settings) -------------------------------------------

export type FolderAccessConfig = {
  folders: DesignFolderType[];
  /** Design department roles, for the matrix columns. */
  roles: DesignRole[];
  /** Capability keyed by `${folder_key}:${role_id}`; absent = no access. */
  access: Record<string, FolderCapability>;
};

/** The folder catalogue + design roles + current access grants, for the editor.
 * Roles come from design_settings_roles() — the SAME list (and same
 * design.folder:manage gate) as the Project Roles editor — so every role you
 * create shows up here as a new matrix column automatically. */
export async function getFolderAccessConfig(): Promise<FolderAccessConfig> {
  const supabase = await createClient();
  const [foldersRes, rolesRes, accessRes] = await Promise.all([
    supabase.from("design_folder_types").select("key, label, sort, description").order("sort"),
    supabase.rpc("design_settings_roles"),
    supabase.from("design_folder_access").select("folder_key, role_id, capability"),
  ]);

  const access: Record<string, FolderCapability> = {};
  for (const a of (accessRes.data ?? []) as DesignFolderAccess[]) {
    access[`${a.folder_key}:${a.role_id}`] = a.capability;
  }
  return {
    folders: (foldersRes.data ?? []) as DesignFolderType[],
    roles: ((rolesRes.data ?? []) as { id: string; label: string }[]).map((r) => ({
      id: r.id,
      label: r.label,
    })) as DesignRole[],
    access,
  };
}

// --- Project roles (settings) ------------------------------------------------

/** A Design project role as shown in the settings editor. */
export type ProjectRoleRow = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  is_system: boolean;
};

export type ProjectRolesConfig = {
  roles: ProjectRoleRow[];
  /** Grants for those roles, as (role_id, resource, action) tuples. */
  permissions: { role_id: string; resource: string; action: Action }[];
};

/**
 * The Design department's project roles + their grants, for the self-service
 * "Project roles" matrix on the settings page. Backed by SECURITY DEFINER RPCs
 * gated on design.folder:manage, so a Design manager can read them without the
 * global access:read permission.
 */
export async function getProjectRolesConfig(): Promise<ProjectRolesConfig> {
  const supabase = await createClient();
  const [rolesRes, permsRes] = await Promise.all([
    supabase.rpc("design_settings_roles"),
    supabase.rpc("design_settings_role_permissions"),
  ]);
  return {
    roles: (rolesRes.data ?? []) as ProjectRoleRow[],
    permissions: (permsRes.data ?? []) as {
      role_id: string;
      resource: string;
      action: Action;
    }[],
  };
}

// --- Controlled folders (per project) ----------------------------------------

/** The 12 folders for a project with the caller's capability rank + lock state. */
export async function getProjectFolders(
  projectId: string
): Promise<ProjectFolder[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("design_project_folders", {
    p_project: projectId,
  });
  return (data ?? []) as ProjectFolder[];
}

/** Files in one project folder (RLS scopes to folders the caller can view). */
export async function getFolderFiles(
  projectId: string,
  folderKey: string
): Promise<DesignFile[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("project_files")
    .select(
      "id, project_id, folder_key, name, storage_path, mime_type, size_bytes, version_no, is_current, source_file_id, created_at"
    )
    .eq("project_id", projectId)
    .eq("folder_key", folderKey)
    .order("created_at", { ascending: false });
  return (data ?? []) as DesignFile[];
}

/** The change-order register for a project. */
export async function getProjectChangeRequests(
  projectId: string
): Promise<DesignChangeRequest[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("project_change_requests")
    .select(
      "id, project_id, folder_key, title, reason, status, raised_at, decided_at, decision_note"
    )
    .eq("project_id", projectId)
    .order("raised_at", { ascending: false });
  return (data ?? []) as DesignChangeRequest[];
}

/** Every checklist step (across stages), for the checklist editor. */
export async function getStageSteps(): Promise<DesignStageStep[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("design_stage_steps")
    .select("id, stage, sort, label")
    .order("sort");
  return (data ?? []) as DesignStageStep[];
}

export type { ProjectStatus, BriefStatus };
