"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/core/supabase/server";
import { createAdminClient } from "@/core/supabase/admin";
import { authorize, authorizeProject } from "@/core/rbac/can";
import { getUser } from "@/core/auth/get-user";
import { logAudit } from "@/modules/audit/log";
import { getBriefForPdf } from "@/modules/design/data";
import { renderBriefPdf } from "@/modules/design/brief-pdf";
import type {
  Discipline,
  DesignStage,
  FolderCapability,
} from "@/modules/design/types";

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

/** Render the approved brief as a PDF and file it into the Project Brief folder.
 * System-generated, so it uses the service role (the approver may not hold
 * folder edit rights). Best-effort — the caller must not let it block approval. */
async function fileApprovedBriefPdf(
  briefId: string,
  projectId: string,
  userId: string | null
): Promise<void> {
  const data = await getBriefForPdf(briefId);
  if (!data) return;
  const bytes = await renderBriefPdf(data);
  const name = `Project Brief — ${data.templateLabel}.pdf`;

  const admin = createAdminClient();
  // Supersede any prior auto-filed version of the same brief document.
  const { data: prior } = await admin
    .from("design_files")
    .select("id, version_no")
    .eq("project_id", projectId)
    .eq("folder_key", "project_brief")
    .eq("name", name)
    .order("version_no", { ascending: false });
  const nextNo = (prior?.[0]?.version_no ?? 0) + 1;

  const id = crypto.randomUUID();
  const safeName = name.replace(/[^\w.\- ]+/g, "_");
  const path = `${projectId}/project_brief/${id}-v${nextNo}-${safeName}`;
  const { error: upErr } = await admin.storage
    .from(BUCKET)
    .upload(path, Buffer.from(bytes), { contentType: "application/pdf", upsert: false });
  if (upErr) throw upErr;

  if (prior?.length) {
    await admin
      .from("design_files")
      .update({ is_current: false })
      .eq("project_id", projectId)
      .eq("folder_key", "project_brief")
      .eq("name", name);
  }
  await admin.from("design_files").insert({
    id,
    project_id: projectId,
    folder_key: "project_brief",
    name,
    storage_path: path,
    mime_type: "application/pdf",
    size_bytes: bytes.length,
    version_no: nextNo,
    is_current: true,
    uploaded_by: userId,
  });
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

  // Archive the signed-off brief as a PDF in the Project Brief folder.
  // Best-effort: a failure here must never undo the approval.
  try {
    await fileApprovedBriefPdf(briefId, brief.project_id, user?.id ?? null);
  } catch (e) {
    console.error("Failed to file approved brief PDF:", e);
  }

  await logAudit("design.brief.approve", "Approved a brief", { briefId });
  revalidatePath(`/design/${brief.project_id}/brief/${briefId}`);
  revalidatePath(`/design/${brief.project_id}`);
  revalidatePath(`/design/${brief.project_id}/folder/project_brief`);
  return ok;
}

// ============================== STAGE PROGRESS ===============================

/** Tick / untick a checklist step for a project. Drives the progress bars. */
export async function toggleProjectStep(
  projectId: string,
  stepId: string,
  done: boolean
): Promise<ActionResult> {
  const denied = await authorizeProject(projectId, "design.project", "update");
  if (denied) return denied;

  const supabase = await createClient();
  const user = await getUser();
  const { error } = await supabase.from("design_project_steps").upsert({
    project_id: projectId,
    step_id: stepId,
    done,
    done_by: done ? user?.id ?? null : null,
    done_at: done ? new Date().toISOString() : null,
  });
  if (error) return fail(error.message);
  revalidatePath(`/design/${projectId}`);
  return ok;
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

// ============================== STAGE CHECKLIST ==============================

export async function addStageStep(
  stage: DesignStage,
  label: string
): Promise<ActionResult> {
  const denied = await authorize("design.folder", "manage");
  if (denied) return denied;
  const t = label.trim();
  if (!t) return fail("Enter a step.");
  const supabase = await createClient();
  const { data: max } = await supabase
    .from("design_stage_steps")
    .select("sort")
    .eq("stage", stage)
    .order("sort", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await supabase
    .from("design_stage_steps")
    .insert({ stage, label: t, sort: (max?.sort ?? 0) + 1 });
  if (error) return fail(error.message);
  revalidatePath("/design/settings");
  return ok;
}

export async function updateStageStep(
  stepId: string,
  label: string
): Promise<ActionResult> {
  const denied = await authorize("design.folder", "manage");
  if (denied) return denied;
  const t = label.trim();
  if (!t) return fail("Enter a step.");
  const supabase = await createClient();
  const { error } = await supabase
    .from("design_stage_steps")
    .update({ label: t })
    .eq("id", stepId);
  if (error) return fail(error.message);
  revalidatePath("/design/settings");
  return ok;
}

export async function deleteStageStep(stepId: string): Promise<ActionResult> {
  const denied = await authorize("design.folder", "manage");
  if (denied) return denied;
  const supabase = await createClient();
  const { error } = await supabase.from("design_stage_steps").delete().eq("id", stepId);
  if (error) return fail(error.message);
  revalidatePath("/design/settings");
  return ok;
}

// ============================== FILES ========================================

const BUCKET = "design-files";

/** Whether the caller may add/replace/remove files in a folder right now
 * (approver any time; editor only while the folder isn't locked). */
async function canWriteFolder(
  projectId: string,
  folderKey: string
): Promise<boolean> {
  const supabase = await createClient();
  const [{ data: approve }, { data: edit }, { data: locked }] = await Promise.all([
    supabase.rpc("has_folder_capability", { p_project: projectId, p_folder: folderKey, p_min: "approve" }),
    supabase.rpc("has_folder_capability", { p_project: projectId, p_folder: folderKey, p_min: "edit" }),
    supabase.rpc("is_folder_locked", { p_project: projectId, p_folder: folderKey }),
  ]);
  return approve === true || (edit === true && locked !== true);
}

/** Upload a file into a project folder. Bytes go to private Storage via the
 * service role; the metadata row is written through RLS as the user. */
export async function uploadFile(
  projectId: string,
  folderKey: string,
  formData: FormData
): Promise<ActionResult> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("Choose a file.");
  if (!(await canWriteFolder(projectId, folderKey)))
    return fail("This folder is read-only for you, or it's locked at this stage.");

  const id = crypto.randomUUID();
  const safeName = file.name.replace(/[^\w.\- ]+/g, "_");
  const path = `${projectId}/${folderKey}/${id}-${safeName}`;

  const admin = createAdminClient();
  const { error: upErr } = await admin.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (upErr) return fail(upErr.message);

  const supabase = await createClient();
  const user = await getUser();
  const { error } = await supabase.from("design_files").insert({
    id,
    project_id: projectId,
    folder_key: folderKey,
    name: file.name,
    storage_path: path,
    mime_type: file.type || null,
    size_bytes: file.size,
    uploaded_by: user?.id ?? null,
  });
  if (error) {
    // RLS rejected (or other) — don't leave orphaned bytes.
    await admin.storage.from(BUCKET).remove([path]);
    return fail(error.message);
  }
  await logAudit("design.folder.upload", "Uploaded a file", { projectId, folderKey, name: file.name });
  revalidatePath(`/design/${projectId}/folder/${folderKey}`);
  return ok;
}

/** A short-lived signed download URL for a file the caller can view. */
export async function getFileDownloadUrl(
  fileId: string
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  // RLS ensures the caller can only read files in folders they can view.
  const { data: file } = await supabase
    .from("design_files")
    .select("storage_path, name")
    .eq("id", fileId)
    .maybeSingle();
  if (!file) return { ok: false, error: "File not found." };

  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(file.storage_path, 60, { download: file.name });
  if (error || !data)
    return { ok: false, error: error?.message ?? "Could not create a link." };
  return { ok: true, url: data.signedUrl };
}

export async function deleteFile(fileId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: file } = await supabase
    .from("design_files")
    .select("project_id, folder_key, storage_path, name")
    .eq("id", fileId)
    .maybeSingle();
  if (!file) return fail("File not found.");
  if (!(await canWriteFolder(file.project_id, file.folder_key)))
    return fail("This folder is read-only for you, or it's locked at this stage.");

  const { error } = await supabase.from("design_files").delete().eq("id", fileId);
  if (error) return fail(error.message);
  createAdminClient().storage.from(BUCKET).remove([file.storage_path]);
  await logAudit("design.folder.delete-file", "Deleted a file", {
    projectId: file.project_id,
    folderKey: file.folder_key,
    name: file.name,
  });
  revalidatePath(`/design/${file.project_id}/folder/${file.folder_key}`);
  return ok;
}

/** Issue a controlled GFC package: copy the chosen files into GFC Issued as the
 * new current version, superseding any prior issue with the same name. */
export async function issueFiles(
  projectId: string,
  fileIds: string[]
): Promise<ActionResult> {
  if (!fileIds.length) return fail("Pick at least one file to issue.");
  const supabase = await createClient();
  const { data: canIssue } = await supabase.rpc("has_folder_capability", {
    p_project: projectId,
    p_folder: "gfc_issued",
    p_min: "approve",
  });
  if (canIssue !== true) return fail("Only the design head can issue the GFC package.");

  const admin = createAdminClient();
  const user = await getUser();
  for (const fileId of fileIds) {
    const { data: src } = await supabase
      .from("design_files")
      .select("name, storage_path, mime_type, size_bytes")
      .eq("id", fileId)
      .maybeSingle();
    if (!src) continue;

    // Latest issued version of this name, so we can bump it.
    const { data: prior } = await supabase
      .from("design_files")
      .select("id, version_no")
      .eq("project_id", projectId)
      .eq("folder_key", "gfc_issued")
      .eq("name", src.name)
      .order("version_no", { ascending: false });
    const nextNo = (prior?.[0]?.version_no ?? 0) + 1;

    const newId = crypto.randomUUID();
    const safeName = src.name.replace(/[^\w.\- ]+/g, "_");
    const toPath = `${projectId}/gfc_issued/${newId}-v${nextNo}-${safeName}`;
    const { error: copyErr } = await admin.storage
      .from(BUCKET)
      .copy(src.storage_path, toPath);
    if (copyErr) return fail(copyErr.message);

    // Supersede previous current issues of this name.
    if (prior?.length) {
      await supabase
        .from("design_files")
        .update({ is_current: false })
        .eq("project_id", projectId)
        .eq("folder_key", "gfc_issued")
        .eq("name", src.name);
    }
    const { error } = await supabase.from("design_files").insert({
      id: newId,
      project_id: projectId,
      folder_key: "gfc_issued",
      name: src.name,
      storage_path: toPath,
      mime_type: src.mime_type,
      size_bytes: src.size_bytes,
      version_no: nextNo,
      is_current: true,
      source_file_id: fileId,
      uploaded_by: user?.id ?? null,
    });
    if (error) {
      await admin.storage.from(BUCKET).remove([toPath]);
      return fail(error.message);
    }
  }
  await logAudit("design.folder.issue", "Issued GFC files", { projectId, count: fileIds.length });
  revalidatePath(`/design/${projectId}/folder/gfc_issued`);
  revalidatePath(`/design/${projectId}`);
  return ok;
}

// ============================== CHANGE ORDERS ================================

export async function raiseChangeRequest(
  projectId: string,
  title: string,
  reason: string,
  folderKey: string | null
): Promise<ActionResult> {
  const denied = await authorizeProject(projectId, "design.project", "read");
  if (denied) return denied;
  const t = title.trim();
  if (!t) return fail("Enter what needs to change.");
  const supabase = await createClient();
  const user = await getUser();
  const { error } = await supabase.from("design_change_requests").insert({
    project_id: projectId,
    title: t,
    reason: reason.trim() || null,
    folder_key: folderKey,
    raised_by: user?.id ?? null,
  });
  if (error) return fail(error.message);
  await logAudit("design.change.raise", "Raised a change request", { projectId, title: t });
  revalidatePath(`/design/${projectId}`);
  return ok;
}

export async function decideChangeRequest(
  requestId: string,
  decision: "approved" | "rejected",
  note: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: cr } = await supabase
    .from("design_change_requests")
    .select("project_id, status")
    .eq("id", requestId)
    .maybeSingle();
  if (!cr) return fail("Change request not found.");
  const denied = await authorizeProject(cr.project_id, "design.project", "approve");
  if (denied) return denied;
  if (cr.status !== "open") return fail("This request has already been decided.");

  const user = await getUser();
  const { error } = await supabase
    .from("design_change_requests")
    .update({
      status: decision,
      decided_by: user?.id ?? null,
      decided_at: new Date().toISOString(),
      decision_note: note.trim() || null,
    })
    .eq("id", requestId);
  if (error) return fail(error.message);
  await logAudit("design.change.decide", `Change request ${decision}`, { requestId });
  revalidatePath(`/design/${cr.project_id}`);
  return ok;
}
