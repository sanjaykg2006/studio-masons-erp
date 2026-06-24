import "server-only";

import { createClient } from "@/core/supabase/server";
import { getProjectPermissions } from "@/core/rbac/permissions";
import { permissionKey, type PermissionKey } from "@/core/rbac/types";
import type {
  BriefStatus,
  DesignBrief,
  DesignProject,
  DesignTemplate,
  DesignTemplateColumn,
  DesignTemplateQuestion,
  DesignTemplateSection,
  DesignTemplateVersion,
  Discipline,
  ProjectStatus,
  TemplateStatus,
} from "@/modules/design/types";

// --- Templates ---------------------------------------------------------------

export type TemplateSummary = DesignTemplate & {
  publishedVersion: number | null;
  hasDraft: boolean;
};

/** All templates with their version state, for the library page. */
export async function listTemplates(): Promise<TemplateSummary[]> {
  const supabase = await createClient();
  const [{ data: templates }, { data: versions }] = await Promise.all([
    supabase
      .from("design_templates")
      .select("id, key, label, discipline, is_active")
      .order("label"),
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
    .from("design_projects")
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
    .from("design_projects")
    .select(
      "id, code, name, client, location, status, created_by, created_at, finalised_at"
    )
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return null;

  const [membersRes, briefsRes, permSet] = await Promise.all([
    supabase.rpc("design_project_members_view", { p_project: projectId }),
    supabase
      .from("design_briefs")
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
    .from("design_briefs")
    .select(
      "id, project_id, template_id, template_version_id, discipline, status, approved_at"
    )
    .eq("id", briefId)
    .maybeSingle();
  if (!brief) return null;

  const [{ data: project }, tree, { data: answerRows }, permSet] =
    await Promise.all([
      supabase
        .from("design_projects")
        .select("id, name, status")
        .eq("id", brief.project_id)
        .single(),
      loadVersionTree(brief.template_version_id),
      supabase
        .from("design_brief_answers")
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
    permSet.has(permissionKey("design.brief", action as never)) ||
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
    .select("id, template_id, version_no, status, design_templates(label, discipline, is_active)")
    .eq("status", "published");

  const best = new Map<
    string,
    { id: string; label: string; discipline: Discipline; version_no: number }
  >();
  for (const v of (versions ?? []) as unknown as {
    id: string;
    template_id: string;
    version_no: number;
    design_templates: { label: string; discipline: Discipline; is_active: boolean } | null;
  }[]) {
    if (!v.design_templates?.is_active) continue;
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

export type { ProjectStatus, BriefStatus };
