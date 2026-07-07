import "server-only";

import { createClient } from "@/core/supabase/server";
import { resourcesForModules } from "@/core/modules/registry";
import type { Action } from "@/core/rbac/types";
import type { FolderAccessConfig, ProjectRoleRow } from "@/modules/design/data";
import type {
  DesignFolderAccess,
  DesignFolderType,
  FolderCapability,
} from "@/modules/design/types";

export type MyDepartment = {
  id: string;
  key: string;
  label: string;
  is_lead: boolean;
  can_manage: boolean;
};

/** The departments the caller belongs to (team member, lead, or admin). */
export async function getMyDepartments(): Promise<MyDepartment[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_departments");
  return (data ?? []) as MyDepartment[];
}

/** One department's summary (or null if the caller can't see it). */
export async function getDepartment(deptId: string): Promise<MyDepartment | null> {
  const mine = await getMyDepartments();
  return mine.find((d) => d.id === deptId) ?? null;
}

/** Resolve a department's id from its stable key (e.g. "design"). RLS lets a
 *  department lead read their own row and an admin read any. */
export async function getDepartmentIdByKey(key: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("departments")
    .select("id")
    .eq("key", key)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/** The module ids allotted to a department: its own `department_modules` plus any
 *  module flagged general. The single source of truth for what a department can
 *  grant — no hardcoded lists. */
export async function getDepartmentModuleIds(deptId: string): Promise<Set<string>> {
  const supabase = await createClient();
  const [modsRes, settingsRes] = await Promise.all([
    supabase.from("department_modules").select("module_id").eq("department_id", deptId),
    supabase.from("module_settings").select("module_id, is_general"),
  ]);
  return new Set<string>([
    ...((modsRes.data ?? []) as { module_id: string }[]).map((m) => m.module_id),
    ...((settingsRes.data ?? []) as { module_id: string; is_general: boolean }[])
      .filter((s) => s.is_general)
      .map((s) => s.module_id),
  ]);
}

/** A matrix row: a resource id, a clean label and the verbs it supports. */
export type MatrixResource = { id: string; label: string; actions: Action[] };

/**
 * The rows for a department's "Project roles" matrix: the PER-PROJECT abilities
 * (`projectRole`) of the modules allotted to it — what a role can do on a project.
 * Company-wide modules and department libraries are excluded (they aren't
 * projectRole), so only project work shows here. Data-driven: allot a project
 * module → its rows appear; nothing is hardcoded per department. The leading
 * "Word · " label prefix is dropped for a cleaner column header.
 */
export async function getDepartmentRoleResources(deptId: string): Promise<MatrixResource[]> {
  const ids = await getDepartmentModuleIds(deptId);
  return resourcesForModules(ids)
    .filter((r) => r.projectRole)
    .map((r) => ({
      id: r.id,
      label: r.label.replace(/^\w+ ·\s*/, ""),
      actions: r.actions,
    }));
}

export type DepartmentRolesConfig = {
  roles: ProjectRoleRow[];
  permissions: { role_id: string; resource: string; action: Action }[];
};

/** A department's project roles + their grants, for the settings matrix. */
export async function getDepartmentRolesConfig(
  deptId: string
): Promise<DepartmentRolesConfig> {
  const supabase = await createClient();
  const [rolesRes, permsRes] = await Promise.all([
    supabase.rpc("department_roles", { p_dept: deptId }),
    supabase.rpc("department_role_permissions", { p_dept: deptId }),
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

/**
 * A department's controlled-folder access grid: the shared folder catalogue
 * (same 12 folders every department uses) × the department's own project roles →
 * capability. Only meaningful when the department holds the `folder.access`
 * module. Roles/grants come from SECURITY DEFINER RPCs gated on the caller being
 * able to manage the department (its lead or an access admin), mirroring
 * getDepartmentRolesConfig — so a lead reads it without global access:read.
 */
export async function getDepartmentFolderAccess(
  deptId: string
): Promise<FolderAccessConfig> {
  const supabase = await createClient();
  const [foldersRes, rolesRes, accessRes] = await Promise.all([
    supabase
      .from("design_folder_types")
      .select("key, label, sort, description")
      .order("sort"),
    supabase.rpc("department_roles", { p_dept: deptId }),
    supabase.rpc("department_folder_access", { p_dept: deptId }),
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
    })),
    access,
  };
}
