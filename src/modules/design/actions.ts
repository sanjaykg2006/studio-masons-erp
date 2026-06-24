"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/core/supabase/server";
import { createAdminClient } from "@/core/supabase/admin";
import { authorize, authorizeProject } from "@/core/rbac/can";
import { getUser } from "@/core/auth/get-user";
import { logAudit } from "@/modules/audit/log";
import type { Discipline } from "@/modules/design/types";

export type ActionResult = { ok: true } | { ok: false; error: string };
const ok: ActionResult = { ok: true };
const fail = (error: string): ActionResult => ({ ok: false, error });

function toKey(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

// ============================== TEMPLATES ====================================

/** Create a new template with an empty published-ready draft v1. */
export async function createTemplate(
  label: string,
  discipline: Discipline
): Promise<ActionResult> {
  const denied = await authorize("design.template", "create");
  if (denied) return denied;
  const trimmed = label.trim();
  const key = toKey(trimmed);
  if (!trimmed || !key) return fail("Enter a template name.");

  const supabase = await createClient();
  const { data: tpl, error } = await supabase
    .from("design_templates")
    .insert({ key, label: trimmed, discipline })
    .select("id")
    .single();
  if (error)
    return fail(error.code === "23505" ? "A template with that name exists." : error.message);

  const { error: vErr } = await supabase
    .from("design_template_versions")
    .insert({ template_id: tpl.id, version_no: 1, status: "draft" });
  if (vErr) return fail(vErr.message);

  await logAudit("design.template.create", `Created template "${trimmed}"`, { key });
  revalidatePath("/design/templates");
  return ok;
}

/**
 * Ensure an editable DRAFT version exists for a template, cloning the latest
 * published version's structure into it. Published versions are immutable (a
 * brief may reference them), so all edits happen on a draft.
 */
export async function startTemplateDraft(templateId: string): Promise<ActionResult> {
  const denied = await authorize("design.template", "update");
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
  const denied = await authorize("design.template", "approve");
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

async function templateUpdate(): Promise<ActionResult | null> {
  return authorize("design.template", "update");
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

// ============================== PROJECTS =====================================

export async function createProject(
  name: string,
  code: string,
  client: string,
  location: string
): Promise<ActionResult> {
  const denied = await authorize("design.project", "create");
  if (denied) return denied;
  const trimmed = name.trim();
  if (!trimmed) return fail("Enter a project name.");

  const supabase = await createClient();
  const { data: project, error } = await supabase
    .from("design_projects")
    .insert({
      name: trimmed,
      code: code.trim() || null,
      client: client.trim() || null,
      location: location.trim() || null,
    })
    .select("id")
    .single();
  if (error)
    return fail(error.code === "23505" ? "That project code is already in use." : error.message);

  // Make the creator the project's accountable Project Lead so they can see and
  // run it. Uses the admin client (role lookup + membership bypass RLS) after
  // the create permission check above.
  const admin = createAdminClient();
  const user = await getUser();
  const { data: lead } = await admin
    .from("roles")
    .select("id")
    .eq("key", "design_project_lead")
    .maybeSingle();
  if (user && lead) {
    await admin.from("design_project_members").upsert({
      project_id: project.id,
      user_id: user.id,
      role_id: lead.id,
      added_by: user.id,
    });
  }

  await logAudit("design.project.create", `Created project "${trimmed}"`, { projectId: project.id });
  revalidatePath("/design");
  return ok;
}

export async function updateProject(
  projectId: string,
  fields: { name: string; code: string; client: string; location: string }
): Promise<ActionResult> {
  const denied = await authorizeProject(projectId, "design.project", "update");
  if (denied) return denied;
  const name = fields.name.trim();
  if (!name) return fail("Enter a project name.");
  const supabase = await createClient();
  const { error } = await supabase
    .from("design_projects")
    .update({
      name,
      code: fields.code.trim() || null,
      client: fields.client.trim() || null,
      location: fields.location.trim() || null,
    })
    .eq("id", projectId);
  if (error) return fail(error.message);
  await logAudit("design.project.update", "Updated a project", { projectId });
  revalidatePath(`/design/${projectId}`);
  return ok;
}

export async function deleteProject(projectId: string): Promise<ActionResult> {
  const denied = await authorizeProject(projectId, "design.project", "delete");
  if (denied) return denied;
  const supabase = await createClient();
  const { error } = await supabase.from("design_projects").delete().eq("id", projectId);
  if (error) return fail(error.message);
  await logAudit("design.project.delete", "Deleted a project", { projectId });
  revalidatePath("/design");
  return ok;
}

/** Finalise: only once the brief is approved, and only with project:approve. */
export async function finaliseProject(projectId: string): Promise<ActionResult> {
  const denied = await authorizeProject(projectId, "design.project", "approve");
  if (denied) return denied;
  const supabase = await createClient();
  const { data: project } = await supabase
    .from("design_projects")
    .select("status")
    .eq("id", projectId)
    .single();
  if (project?.status !== "brief_approved")
    return fail("The brief must be approved before the project can be finalised.");

  const { error } = await supabase
    .from("design_projects")
    .update({ status: "finalised", finalised_at: new Date().toISOString() })
    .eq("id", projectId);
  if (error) return fail(error.message);
  await logAudit("design.project.finalise", "Finalised a project", { projectId });
  revalidatePath(`/design/${projectId}`);
  return ok;
}

// ============================== MEMBERS ======================================

export async function addMember(
  projectId: string,
  userId: string,
  roleId: string
): Promise<ActionResult> {
  const denied = await authorizeProject(projectId, "design.member", "manage");
  if (denied) return denied;
  if (!userId || !roleId) return fail("Pick a person and a role.");
  const supabase = await createClient();
  const { error } = await supabase
    .from("design_project_members")
    .upsert({ project_id: projectId, user_id: userId, role_id: roleId });
  if (error) return fail(error.message);
  await logAudit("design.member.add", "Added a project member", { projectId, userId, roleId });
  revalidatePath(`/design/${projectId}`);
  return ok;
}

export async function removeMember(projectId: string, userId: string): Promise<ActionResult> {
  const denied = await authorizeProject(projectId, "design.member", "manage");
  if (denied) return denied;
  const supabase = await createClient();
  const { error } = await supabase
    .from("design_project_members")
    .delete()
    .match({ project_id: projectId, user_id: userId });
  if (error) return fail(error.message);
  await logAudit("design.member.remove", "Removed a project member", { projectId, userId });
  revalidatePath(`/design/${projectId}`);
  return ok;
}

// ============================== BRIEFS =======================================

/** Start one brief per chosen template (latest published version). */
export async function createBriefs(
  projectId: string,
  templateIds: string[]
): Promise<ActionResult> {
  const denied = await authorizeProject(projectId, "design.brief", "create");
  if (denied) return denied;
  if (!templateIds.length) return fail("Pick at least one questionnaire.");

  const supabase = await createClient();
  for (const templateId of templateIds) {
    const { data: version } = await supabase
      .from("design_template_versions")
      .select("id, design_templates(discipline)")
      .eq("template_id", templateId)
      .eq("status", "published")
      .order("version_no", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!version) continue;
    const discipline = (version as unknown as { design_templates: { discipline: Discipline } })
      .design_templates.discipline;
    const { error } = await supabase.from("design_briefs").insert({
      project_id: projectId,
      template_id: templateId,
      template_version_id: version.id,
      discipline,
    });
    if (error && error.code !== "23505") return fail(error.message);
  }

  // Move the project out of draft on its first brief.
  await supabase
    .from("design_projects")
    .update({ status: "brief_in_progress" })
    .eq("id", projectId)
    .eq("status", "draft");

  await logAudit("design.brief.create", "Started project brief(s)", { projectId, templateIds });
  revalidatePath(`/design/${projectId}`);
  return ok;
}

export async function saveBriefAnswer(
  briefId: string,
  questionId: string,
  values: Record<string, string>
): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: brief } = await supabase
    .from("design_briefs")
    .select("project_id, status")
    .eq("id", briefId)
    .single();
  if (!brief) return fail("Brief not found.");
  if (brief.status === "approved") return fail("This brief is approved and locked for editing.");

  const denied = await authorizeProject(brief.project_id, "design.brief", "update");
  if (denied) return denied;

  const { error } = await supabase
    .from("design_brief_answers")
    .upsert({ brief_id: briefId, question_id: questionId, values, updated_at: new Date().toISOString() });
  if (error) return fail(error.message);
  revalidatePath(`/design/${brief.project_id}/brief/${briefId}`);
  return ok;
}

export async function submitBriefForReview(briefId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: brief } = await supabase
    .from("design_briefs")
    .select("project_id, status")
    .eq("id", briefId)
    .single();
  if (!brief) return fail("Brief not found.");
  const denied = await authorizeProject(brief.project_id, "design.brief", "update");
  if (denied) return denied;
  if (brief.status !== "in_progress") return fail("Only an in-progress brief can be submitted.");

  const { error } = await supabase
    .from("design_briefs")
    .update({ status: "in_review" })
    .eq("id", briefId);
  if (error) return fail(error.message);
  await logAudit("design.brief.submit", "Submitted a brief for review", { briefId });
  revalidatePath(`/design/${brief.project_id}/brief/${briefId}`);
  return ok;
}

/** Reviewer sends a submitted brief back to the team for changes (review verb). */
export async function returnBriefForChanges(briefId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: brief } = await supabase
    .from("design_briefs")
    .select("project_id, status")
    .eq("id", briefId)
    .single();
  if (!brief) return fail("Brief not found.");
  const denied = await authorizeProject(brief.project_id, "design.brief", "review");
  if (denied) return denied;
  if (brief.status !== "in_review") return fail("Only a brief in review can be returned.");

  const { error } = await supabase
    .from("design_briefs")
    .update({ status: "in_progress" })
    .eq("id", briefId);
  if (error) return fail(error.message);
  await logAudit("design.brief.return", "Returned a brief for changes", { briefId });
  revalidatePath(`/design/${brief.project_id}/brief/${briefId}`);
  return ok;
}

export async function approveBrief(briefId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: brief } = await supabase
    .from("design_briefs")
    .select("project_id, status")
    .eq("id", briefId)
    .single();
  if (!brief) return fail("Brief not found.");
  const denied = await authorizeProject(brief.project_id, "design.brief", "approve");
  if (denied) return denied;
  if (brief.status === "approved") return fail("This brief is already approved.");

  const user = await getUser();
  const { error } = await supabase
    .from("design_briefs")
    .update({ status: "approved", approved_by: user?.id ?? null, approved_at: new Date().toISOString() })
    .eq("id", briefId);
  if (error) return fail(error.message);

  // When every brief on the project is approved, advance the project.
  const { data: remaining } = await supabase
    .from("design_briefs")
    .select("id")
    .eq("project_id", brief.project_id)
    .neq("status", "approved");
  if ((remaining?.length ?? 0) === 0) {
    await supabase
      .from("design_projects")
      .update({ status: "brief_approved" })
      .eq("id", brief.project_id);
  }

  await logAudit("design.brief.approve", "Approved a brief", { briefId });
  revalidatePath(`/design/${brief.project_id}/brief/${briefId}`);
  revalidatePath(`/design/${brief.project_id}`);
  return ok;
}
