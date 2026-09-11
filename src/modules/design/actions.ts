"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/core/supabase/server";
import { authorize } from "@/core/rbac/can";
import { logAudit } from "@/modules/audit/log";
import type { FolderCapability } from "@/modules/design/types";
import type { Discipline } from "@/modules/projects/types";

export type ActionResult = { ok: true } | { ok: false; error: string };
const ok: ActionResult = { ok: true };
const fail = (error: string): ActionResult => ({ ok: false, error });

function toKey(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/** A template library's scope: company-wide (Projects) or a department's own. */
export type TemplateScope = "general" | "design";

/** The resource that gates a scope's templates. */
const scopeResource = (scope: TemplateScope) =>
  scope === "design" ? "design.template" : "project.template";

/**
 * Allow a template mutation if the caller can do it in EITHER library. RLS
 * enforces the exact scope per row, so this is just the app-layer convenience
 * check that turns a denied click into a readable message.
 */
async function authorizeAnyTemplate(
  action: Parameters<typeof authorize>[1]
): Promise<ActionResult | null> {
  const denied = await authorize("project.template", action);
  if (!denied) return null;
  return authorize("design.template", action);
}

// ============================== TEMPLATES ====================================

/** Create a new template in the given library with an empty draft v1. */
export async function createTemplate(
  label: string,
  discipline: Discipline,
  scope: TemplateScope
): Promise<ActionResult> {
  const denied = await authorize(scopeResource(scope), "create");
  if (denied) return denied;
  const trimmed = label.trim();
  const key = toKey(trimmed);
  if (!trimmed || !key) return fail("Enter a template name.");

  const supabase = await createClient();
  // A "design" template is owned by the Design department; "general" ones are
  // company-wide (department_id NULL) and live in the Projects module.
  let departmentId: string | null = null;
  if (scope === "design") {
    const { data: dept } = await supabase
      .from("departments")
      .select("id")
      .eq("key", "design")
      .maybeSingle();
    departmentId = dept?.id ?? null;
  }
  const { data: tpl, error } = await supabase
    .from("design_templates")
    .insert({ key, label: trimmed, discipline, department_id: departmentId })
    .select("id")
    .single();
  if (error)
    return fail(error.code === "23505" ? "A template with that name exists." : error.message);

  const { error: vErr } = await supabase
    .from("design_template_versions")
    .insert({ template_id: tpl.id, version_no: 1, status: "draft" });
  if (vErr) return fail(vErr.message);

  await logAudit("design.template.create", `Created template "${trimmed}"`, { key });
  revalidatePath(scope === "design" ? "/design/templates" : "/projects/templates");
  return ok;
}

/**
 * Ensure an editable DRAFT version exists for a template, cloning the latest
 * published version's structure into it. Published versions are immutable (a
 * brief may reference them), so all edits happen on a draft.
 */
export async function startTemplateDraft(templateId: string): Promise<ActionResult> {
  const denied = await authorizeAnyTemplate("update");
  if (denied) return denied;

  const supabase = await createClient();
  const { data: versions } = await supabase
    .from("design_template_versions")
    .select("id, version_no, status")
    .eq("template_id", templateId)
    .order("version_no", { ascending: false });

  if (versions?.some((v) => v.status === "draft")) return ok; // already editable
  const source = versions?.find((v) => v.status === "published") ?? null;
  const nextNo = (versions?.[0]?.version_no ?? 0) + 1;

  const { data: draft, error } = await supabase
    .from("design_template_versions")
    .insert({ template_id: templateId, version_no: nextNo, status: "draft" })
    .select("id")
    .single();
  if (error) return fail(error.message);

  if (source) {
    const cloneErr = await cloneVersionStructure(source.id, draft.id);
    if (cloneErr) return fail(cloneErr);
  }
  await logAudit("design.template.draft", "Opened a template draft", { templateId, versionId: draft.id });
  revalidatePath(`/design/templates/${templateId}`);
  return ok;
}

/** Copy columns + sections + questions from one version into another. */
async function cloneVersionStructure(fromId: string, toId: string): Promise<string | null> {
  const supabase = await createClient();
  const [{ data: cols }, { data: secs }] = await Promise.all([
    supabase.from("design_template_columns").select("sort, key, label, kind").eq("version_id", fromId),
    supabase.from("design_template_sections").select("id, sort, title").eq("version_id", fromId).order("sort"),
  ]);

  if (cols?.length) {
    const { error } = await supabase
      .from("design_template_columns")
      .insert(cols.map((c) => ({ ...c, version_id: toId })));
    if (error) return error.message;
  }

  for (const s of secs ?? []) {
    const { data: newSec, error } = await supabase
      .from("design_template_sections")
      .insert({ version_id: toId, sort: s.sort, title: s.title })
      .select("id")
      .single();
    if (error) return error.message;
    const { data: qs } = await supabase
      .from("design_template_questions")
      .select("sort, text")
      .eq("section_id", s.id)
      .order("sort");
    if (qs?.length) {
      const { error: qErr } = await supabase
        .from("design_template_questions")
        .insert(qs.map((q) => ({ section_id: newSec.id, sort: q.sort, text: q.text })));
      if (qErr) return qErr.message;
    }
  }
  return null;
}

/** Publish a draft version, retiring any previously published one. Publishing
 * is the approval step, so it needs the template "approve" verb. */
export async function publishTemplateVersion(versionId: string): Promise<ActionResult> {
  const denied = await authorizeAnyTemplate("approve");
  if (denied) return denied;

  const supabase = await createClient();
  const { data: version } = await supabase
    .from("design_template_versions")
    .select("id, template_id")
    .eq("id", versionId)
    .single();
  if (!version) return fail("Version not found.");

  // Archive prior published versions of this template.
  await supabase
    .from("design_template_versions")
    .update({ status: "archived" })
    .eq("template_id", version.template_id)
    .eq("status", "published");

  const { error } = await supabase
    .from("design_template_versions")
    .update({ status: "published" })
    .eq("id", versionId);
  if (error) return fail(error.message);

  await logAudit("design.template.publish", "Published a template version", { versionId });
  revalidatePath(`/design/templates/${version.template_id}`);
  revalidatePath("/design/templates");
  return ok;
}

/** Delete a template and its versions. Blocked if any brief was built from it. */
export async function deleteTemplate(templateId: string): Promise<ActionResult> {
  const denied = await authorizeAnyTemplate("delete");
  if (denied) return denied;

  const supabase = await createClient();
  const { error } = await supabase
    .from("design_templates")
    .delete()
    .eq("id", templateId);
  if (error)
    return fail(
      error.code === "23503"
        ? "This template has briefs built from it and can't be deleted."
        : error.message
    );
  await logAudit("design.template.delete", "Deleted a template", { templateId });
  revalidatePath("/design/templates");
  revalidatePath("/projects/templates");
  return ok;
}

async function templateUpdate(): Promise<ActionResult | null> {
  return authorizeAnyTemplate("update");
}

export async function addSection(versionId: string, title: string): Promise<ActionResult> {
  const denied = await templateUpdate();
  if (denied) return denied;
  const t = title.trim();
  if (!t) return fail("Enter a section title.");
  const supabase = await createClient();
  const { data: max } = await supabase
    .from("design_template_sections")
    .select("sort")
    .eq("version_id", versionId)
    .order("sort", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await supabase
    .from("design_template_sections")
    .insert({ version_id: versionId, title: t, sort: (max?.sort ?? -1) + 1 });
  if (error) return fail(error.message);
  revalidatePath("/design/templates", "layout");
  return ok;
}

export async function updateSection(sectionId: string, title: string): Promise<ActionResult> {
  const denied = await templateUpdate();
  if (denied) return denied;
  const supabase = await createClient();
  const { error } = await supabase
    .from("design_template_sections")
    .update({ title: title.trim() })
    .eq("id", sectionId);
  if (error) return fail(error.message);
  revalidatePath("/design/templates", "layout");
  return ok;
}

export async function deleteSection(sectionId: string): Promise<ActionResult> {
  const denied = await templateUpdate();
  if (denied) return denied;
  const supabase = await createClient();
  const { error } = await supabase.from("design_template_sections").delete().eq("id", sectionId);
  if (error) return fail(error.message);
  revalidatePath("/design/templates", "layout");
  return ok;
}

export async function addQuestion(sectionId: string, text: string): Promise<ActionResult> {
  const denied = await templateUpdate();
  if (denied) return denied;
  const t = text.trim();
  if (!t) return fail("Enter a question.");
  const supabase = await createClient();
  const { data: max } = await supabase
    .from("design_template_questions")
    .select("sort")
    .eq("section_id", sectionId)
    .order("sort", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await supabase
    .from("design_template_questions")
    .insert({ section_id: sectionId, text: t, sort: (max?.sort ?? -1) + 1 });
  if (error) return fail(error.message);
  revalidatePath("/design/templates", "layout");
  return ok;
}

export async function updateQuestion(questionId: string, text: string): Promise<ActionResult> {
  const denied = await templateUpdate();
  if (denied) return denied;
  const supabase = await createClient();
  const { error } = await supabase
    .from("design_template_questions")
    .update({ text: text.trim() })
    .eq("id", questionId);
  if (error) return fail(error.message);
  revalidatePath("/design/templates", "layout");
  return ok;
}

export async function deleteQuestion(questionId: string): Promise<ActionResult> {
  const denied = await templateUpdate();
  if (denied) return denied;
  const supabase = await createClient();
  const { error } = await supabase.from("design_template_questions").delete().eq("id", questionId);
  if (error) return fail(error.message);
  revalidatePath("/design/templates", "layout");
  return ok;
}

/** Swap a row's `sort` with its neighbour in the given direction. */
async function reorder(
  table: "design_template_sections" | "design_template_questions",
  scopeCol: "version_id" | "section_id",
  scopeId: string,
  rowId: string,
  dir: "up" | "down"
): Promise<ActionResult> {
  const denied = await templateUpdate();
  if (denied) return denied;
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from(table)
    .select("id, sort")
    .eq(scopeCol, scopeId)
    .order("sort");
  if (!rows) return fail("Could not reorder.");
  const i = rows.findIndex((r) => r.id === rowId);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= rows.length) return ok;
  await supabase.from(table).update({ sort: rows[j].sort }).eq("id", rows[i].id);
  await supabase.from(table).update({ sort: rows[i].sort }).eq("id", rows[j].id);
  revalidatePath("/design/templates", "layout");
  return ok;
}

export async function moveSection(
  versionId: string,
  sectionId: string,
  dir: "up" | "down"
): Promise<ActionResult> {
  return reorder("design_template_sections", "version_id", versionId, sectionId, dir);
}

export async function moveQuestion(
  sectionId: string,
  questionId: string,
  dir: "up" | "down"
): Promise<ActionResult> {
  return reorder("design_template_questions", "section_id", sectionId, questionId, dir);
}

// ============================== FOLDER ACCESS ================================

/** Set (or clear, when capability is null) a role's capability on a folder. */
export async function setFolderAccess(
  folderKey: string,
  roleId: string,
  capability: FolderCapability | null
): Promise<ActionResult> {
  const denied = await authorize("design.folder", "manage");
  if (denied) return denied;

  const supabase = await createClient();
  if (capability === null) {
    const { error } = await supabase
      .from("design_folder_access")
      .delete()
      .match({ folder_key: folderKey, role_id: roleId });
    if (error) return fail(error.message);
  } else {
    const { error } = await supabase
      .from("design_folder_access")
      .upsert({ folder_key: folderKey, role_id: roleId, capability });
    if (error) return fail(error.message);
  }
  await logAudit("design.folder.access", "Changed folder access", {
    folderKey,
    roleId,
    capability,
  });
  revalidatePath("/design/settings");
  return ok;
}

// ============================== PROJECT ROLES ================================
// Self-service Design role management for the settings "Project roles" matrix.
// All writes go through SECURITY DEFINER RPCs (0013) that re-check the
// design.folder:manage permission; the authorize() here is a fast app-layer
// mirror so denied clicks get a readable message instead of a raw DB error.

/** Create a new Design project role. Appears immediately in the member picker. */
export async function createProjectRole(label: string): Promise<ActionResult> {
  const denied = await authorize("design.folder", "manage");
  if (denied) return denied;
  const trimmed = label.trim();
  if (!trimmed) return fail("Enter a role name.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_design_role", { p_label: trimmed });
  if (error)
    return fail(
      error.code === "23505" ? "A role with that name already exists." : error.message
    );
  await logAudit("design.role.create", `Created project role "${trimmed}"`, {
    label: trimmed,
  });
  revalidatePath("/design/settings");
  return ok;
}

/** Delete a Design project role (blocked if assigned to any project member). */
export async function deleteProjectRole(roleId: string): Promise<ActionResult> {
  const denied = await authorize("design.folder", "manage");
  if (denied) return denied;

  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_design_role", { p_role: roleId });
  if (error)
    return fail(
      error.code === "23503"
        ? "This role is assigned to project members. Reassign them first."
        : error.message
    );
  await logAudit("design.role.delete", "Deleted a project role", { roleId });
  revalidatePath("/design/settings");
  return ok;
}

/** Grant or revoke one (resource, action) on a Design role — one matrix cell. */
export async function setProjectRolePermission(
  roleId: string,
  resource: string,
  action: string,
  grant: boolean
): Promise<ActionResult> {
  const denied = await authorize("design.folder", "manage");
  if (denied) return denied;

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_design_role_permission", {
    p_role: roleId,
    p_resource: resource,
    p_action: action,
    p_grant: grant,
  });
  if (error) return fail(error.message);
  await logAudit(
    "design.role.permission",
    `${grant ? "Granted" : "Revoked"} ${resource}:${action} on a project role`,
    { roleId, resource, action, grant }
  );
  revalidatePath("/design/settings");
  return ok;
}

/** Reorder a Design project role in the seniority ladder (up = more senior). */
export async function moveProjectRole(roleId: string, up: boolean): Promise<ActionResult> {
  const denied = await authorize("design.folder", "manage");
  if (denied) return denied;
  const supabase = await createClient();
  const { error } = await supabase.rpc("move_design_role", { p_role: roleId, p_up: up });
  if (error) return fail(error.message);
  revalidatePath("/design/settings");
  return ok;
}

// ============================== SUB-TEAMS ====================================

/** Put a person into (or take them out of) a Concept / Technical sub-team.
 * The RPC checks the caller can manage the team and that the person is already
 * on the department's team. */
export async function setSubteamMember(
  subteamId: string,
  userId: string,
  grant: boolean
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_subteam_member", {
    p_subteam: subteamId,
    p_user: userId,
    p_grant: grant,
  });
  if (error) return fail(error.message);
  await logAudit(
    "design.subteam.member",
    `${grant ? "Added a person to" : "Removed a person from"} a sub-team`,
    { subteamId, userId, grant }
  );
  revalidatePath("/design/settings");
  return ok;
}

// The stage checklist moved to the Projects module: each project owns its own
// steps, seeded from project_step_templates. See modules/projects/actions.ts.
