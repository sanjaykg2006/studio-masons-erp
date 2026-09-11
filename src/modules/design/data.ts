import "server-only";

import { createClient } from "@/core/supabase/server";
import {
  type DesignFolderAccess,
  type DesignFolderType,
  type FolderCapability,
  type DesignTemplate,
  type DesignTemplateColumn,
  type DesignTemplateQuestion,
  type DesignTemplateSection,
  type DesignTemplateVersion,
  type TemplateStatus,
} from "@/modules/design/types";

/** A project role / assignable-person reference, as shown in a settings matrix. */
export type DesignRole = { id: string; label: string };

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

/** Load one version's full structure (columns + sections + questions). Exported
 * because the Projects module reuses it to render briefs built from templates. */
export async function loadVersionTree(
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

// --- Controlled folders (settings) -------------------------------------------

export type FolderAccessConfig = {
  folders: DesignFolderType[];
  /** Design department roles, for the matrix columns. */
  roles: DesignRole[];
  /** Capability keyed by `${folder_key}:${role_id}`; absent = no access. */
  access: Record<string, FolderCapability>;
};

/** The folder catalogue + design roles + current access grants, for the editor.
 * Roles come from design_settings_roles(), which is now a thin wrapper over the
 * generic department_roles() — the SAME list, and the same gate as every other
 * department (lead of Design, or access:update). So every role you create shows
 * up here as a new matrix column automatically. */
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
  /** Seniority order within the department; 1 = most senior. */
  rank: number;
};

// --- Stage checklist (settings) ----------------------------------------------

/** Every checklist step (across stages), for the checklist editor. */
// getStageSteps moved to the Projects module (project_step_templates).
