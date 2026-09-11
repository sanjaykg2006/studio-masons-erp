import "server-only";

import { createClient } from "@/core/supabase/server";
import { getProjectPermissions } from "@/core/rbac/permissions";
import { permissionKey, type PermissionKey } from "@/core/rbac/types";
import type { BriefPdfData } from "@/modules/projects/brief-pdf";
// Briefs are built FROM the Design department's questionnaire templates, so the
// version-tree loader + its type are reused from there (the one real
// Projects → Design dependency).
import { loadVersionTree, type TemplateTree } from "@/modules/design/data";
import {
  DISCIPLINE_LABEL,
  DESIGN_STAGES,
  DESIGN_STAGE_LABEL,
  type BriefStatus,
  type DesignBrief,
  type DesignChangeRequest,
  type DesignFile,
  type DesignProject,
  type DesignStage,
  type DesignStageStep,
  type Discipline,
  type ProjectFolder,
  type ProjectStep,
  type ProjectProgress,
  type ProjectStatus,
  type StageProgress,
} from "@/modules/projects/types";

// --- Projects ----------------------------------------------------------------

/** Projects the user can see (RLS scopes to membership / department-wide). */
export async function listProjects(): Promise<DesignProject[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select(
      "id, code, name, client, location, status, phase, frozen_at, frozen_by, created_by, created_at, finalised_at"
    )
    .order("created_at", { ascending: false });
  return (data ?? []) as DesignProject[];
}

export type ProjectMemberView = {
  user_id: string;
  full_name: string | null;
  email: string | null;
  role_id: string;
  role_label: string;
  /** On the team through "a role on every project" (People & Access), not
   * added to this project by hand — so it can't be removed here. */
  every_project: boolean;
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
      "id, code, name, client, location, status, phase, frozen_at, frozen_by, created_by, created_at, finalised_at"
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

export type RevisionState = "draft" | "in_review" | null;

export type BriefDetail = {
  brief: DesignBrief;
  project: Pick<DesignProject, "id" | "name" | "status">;
  tree: TemplateTree;
  answers: Record<string, Record<string, string>>; // question_id -> { col: value }
  canEdit: boolean;
  canReview: boolean;
  canApprove: boolean;
  /** Post-freeze revision cycle (null = no revision in progress). */
  revisionState: RevisionState;
  revisionNo: number;
  /** True once the project is frozen (Execution phase) — the design is locked. */
  frozen: boolean;
  /** May start a revision now (frozen, no revision open, holds brief:update). */
  canProposeRevision: boolean;
  /** May approve/return a submitted revision (dept lead OR project:approve). */
  canApproveRevision: boolean;
};

/** A brief with its questionnaire tree, current answers, and the caller's verbs. */
export async function getBriefDetail(
  briefId: string
): Promise<BriefDetail | null> {
  const supabase = await createClient();
  const { data: brief } = await supabase
    .from("project_briefs")
    .select(
      "id, project_id, template_id, template_version_id, discipline, status, approved_at, revision_state, revision_no"
    )
    .eq("id", briefId)
    .maybeSingle();
  if (!brief) return null;

  const [{ data: project }, tree, { data: answerRows }, permSet, { data: canApproveRev }] =
    await Promise.all([
      supabase
        .from("projects")
        .select("id, name, status, phase")
        .eq("id", brief.project_id)
        .single(),
      loadVersionTree(brief.template_version_id),
      supabase
        .from("project_brief_answers")
        .select("question_id, values, draft_values")
        .eq("brief_id", briefId),
      getProjectPermissions(brief.project_id),
      supabase.rpc("can_approve_brief_revision", { p_project: brief.project_id }),
    ]);
  if (!tree || !project) return null;

  const revisionState = (brief.revision_state ?? null) as RevisionState;
  const revising = revisionState === "draft";

  // While revising, show the draft copy; otherwise the published answers.
  const answers: Record<string, Record<string, string>> = {};
  for (const row of (answerRows ?? []) as {
    question_id: string;
    values: Record<string, string> | null;
    draft_values: Record<string, string> | null;
  }[]) {
    answers[row.question_id] =
      (revisionState ? row.draft_values : row.values) ?? row.values ?? {};
  }

  const has = (action: string) =>
    permSet.has(permissionKey("project.brief", action as never)) ||
    permSet.has(permissionKey("*", action as never));

  const frozen = (project as { phase?: string }).phase === "execution";
  const canApproveRevision = Boolean(canApproveRev);

  return {
    brief: brief as DesignBrief,
    project: project as Pick<DesignProject, "id" | "name" | "status">,
    tree,
    answers,
    // Editable pre-freeze as before; once frozen, only while a draft is open.
    canEdit: revising
      ? has("update")
      : has("update") && (brief.status as BriefStatus) !== "approved" && !frozen,
    canReview: has("review"),
    canApprove: has("approve"),
    revisionState,
    revisionNo: (brief.revision_no as number) ?? 0,
    frozen,
    canProposeRevision: has("update") && frozen && !revisionState,
    canApproveRevision,
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
  // The project's OWN checklist. No company-wide catalogue is consulted, so
  // there is nothing here gated on belonging to a particular department.
  const { data: rows } = await supabase
    .from("project_steps")
    .select("id, stage, sort, label, done")
    .eq("project_id", projectId)
    .order("sort");

  const byStage = new Map<DesignStage, ProjectStep[]>();
  for (const s of (rows ?? []) as ProjectStep[]) {
    if (!byStage.has(s.stage)) byStage.set(s.stage, []);
    byStage.get(s.stage)!.push(s);
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

export type { ProjectStatus, BriefStatus };

// --- Concept-phase visibility matrix -----------------------------------------

export type ConceptVisibility = {
  departments: { id: string; label: string }[];
  /** "<ownerId>:<viewerId>" for each allowed pair. */
  allowed: Set<string>;
};

/** The owner x viewer grid behind "who sees a project before the Design Freeze".
 * Null when the caller may not administer access, so the card simply isn't shown. */
export async function getConceptVisibility(): Promise<ConceptVisibility | null> {
  const supabase = await createClient();
  const [{ data: depts }, { data: rows }] = await Promise.all([
    supabase.from("departments").select("id, label").order("label"),
    supabase.rpc("list_concept_visibility"),
  ]);
  if (!depts || !rows) return null;
  const pairs = rows as { owner_department_id: string; viewer_department_id: string }[];
  return {
    departments: depts as { id: string; label: string }[],
    allowed: new Set(pairs.map((p) => `${p.owner_department_id}:${p.viewer_department_id}`)),
  };
}

// --- The company default checklist -------------------------------------------

/** The default steps copied into a new project. Editing these changes what
 * FUTURE projects start with; an existing project's own list is untouched. */
export async function getStepTemplates(): Promise<DesignStageStep[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("project_step_templates")
    .select("id, stage, sort, label")
    .order("sort");
  return (data ?? []) as DesignStageStep[];
}
