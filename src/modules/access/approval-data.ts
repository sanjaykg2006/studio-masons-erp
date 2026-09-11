import "server-only";

import { createClient } from "@/core/supabase/server";
import { effectiveHome, moduleResources } from "@/core/modules/registry";
import { getStoredHomes } from "@/core/modules/homes";
import { ACTION_LABEL, type Action } from "@/core/rbac/types";
import {
  APPROVAL_FLOWS,
  type ApprovalFlow,
  type FlowStep,
} from "@/modules/access/approval-flows";

export type StepWho = {
  /** Job titles with full access ('*') — they can do every step. */
  fullAccess: { label: string; people: string[] }[];
  jobTitles: { label: string; people: string[] }[];
  /** Project roles — on the projects where someone holds them. */
  projectRoles: { department: string; role: string }[];
  /** People ticked on a department's People & Access. */
  people: { department: string; person: string }[];
};

export type StepView = FlowStep & {
  /** "Module → Verb", as the tick reads in the matrices. */
  tick: string | null;
  who: StepWho | null;
  /** Where the tick is given, per the module's current home. */
  changeAt: { label: string; href: string }[];
};

export type FlowView = Omit<ApprovalFlow, "steps"> & { steps: StepView[] };

type Row = { role_id: string; resource: string; action: Action };
type TeamRow = { department_id: string; user_id: string; resource: string; action: Action };

/**
 * The approval flows with, for each step, who can do it right now — read from
 * the same tables the matrices write. Nothing here is consulted when access is
 * enforced; it only describes it. RLS limits the reads to access admins.
 */
export async function getApprovalFlows(): Promise<FlowView[]> {
  const supabase = await createClient();
  const [rolesRes, permsRes, teamRes, peopleRes, deptsRes, deptModsRes, homes] =
    await Promise.all([
      supabase.from("roles").select("id, label, department_id"),
      supabase.from("role_permissions").select("role_id, resource, action"),
      supabase.from("team_member_permissions").select("department_id, user_id, resource, action"),
      supabase.from("profiles").select("id, full_name, email, role_id, deactivated_at"),
      supabase.from("departments").select("id, key, label"),
      supabase.from("department_modules").select("department_id, module_id"),
      getStoredHomes(),
    ]);

  const roles = (rolesRes.data ?? []) as { id: string; label: string; department_id: string | null }[];
  const perms = (permsRes.data ?? []) as Row[];
  const team = (teamRes.data ?? []) as TeamRow[];
  const people = (
    (peopleRes.data ?? []) as {
      id: string;
      full_name: string | null;
      email: string | null;
      role_id: string | null;
      deactivated_at: string | null;
    }[]
  ).filter((p) => !p.deactivated_at);
  const depts = (deptsRes.data ?? []) as { id: string; key: string; label: string }[];
  const deptMods = (deptModsRes.data ?? []) as { department_id: string; module_id: string }[];

  const deptLabel = new Map(depts.map((d) => [d.id, d.label]));
  const name = (p: { full_name: string | null; email: string | null; id: string }) =>
    p.full_name ?? p.email ?? p.id;
  const holders = (roleId: string) =>
    people.filter((p) => p.role_id === roleId).map(name);
  const personName = new Map(people.map((p) => [p.id, name(p)]));
  const resources = new Map(moduleResources().map((r) => [r.id, r]));
  const has = (roleId: string, resource: string, action: Action) =>
    perms.some(
      (p) => p.role_id === roleId && p.action === action && (p.resource === resource || p.resource === "*")
    );

  const whoFor = (resource: string, action: Action): StepWho => {
    const jobTitles = roles.filter((r) => !r.department_id);
    const wildcard = (r: { id: string }) =>
      perms.some((p) => p.role_id === r.id && p.resource === "*" && p.action === action);
    const allowsProjectRoles = resources.get(resource)?.homes?.includes("project") ?? false;
    return {
      fullAccess: jobTitles
        .filter(wildcard)
        .map((r) => ({ label: r.label, people: holders(r.id) })),
      jobTitles: jobTitles
        .filter((r) => !wildcard(r) && has(r.id, resource, action))
        .map((r) => ({ label: r.label, people: holders(r.id) })),
      // A project-role tick only means something on a resource that is checked
      // per project; elsewhere it would be a leftover that grants nothing.
      projectRoles: allowsProjectRoles
        ? roles
            .filter((r) => r.department_id && has(r.id, resource, action))
            .map((r) => ({ department: deptLabel.get(r.department_id!) ?? "—", role: r.label }))
        : [],
      people: team
        .filter((t) => t.resource === resource && t.action === action && personName.has(t.user_id))
        .map((t) => ({
          department: deptLabel.get(t.department_id) ?? "—",
          person: personName.get(t.user_id)!,
        })),
    };
  };

  const changeAt = (resource: string) => {
    const r = resources.get(resource);
    if (!r) return [];
    const home = effectiveHome(r, homes.get(resource));
    if (home === "company") return [{ label: "Access Control → Back Office", href: "/access" }];
    const allotted = depts.filter((d) =>
      deptMods.some((m) => m.department_id === d.id && m.module_id === resource)
    );
    if (home === "department") {
      return allotted.map((d) => ({
        label: `${d.label} → People & Access`,
        href: `/departments/${d.id}/people`,
      }));
    }
    if (home === "project") {
      return allotted.map((d) => ({
        label: `${d.label} → Settings`,
        href: d.key === "design" ? "/design/settings" : `/departments/${d.id}/settings`,
      }));
    }
    return [];
  };

  return APPROVAL_FLOWS.map((flow) => ({
    ...flow,
    steps: flow.steps.map((step) =>
      step.resource && step.action
        ? {
            ...step,
            tick: `${resources.get(step.resource)?.label ?? step.resource} → ${ACTION_LABEL[step.action]}`,
            who: whoFor(step.resource, step.action),
            changeAt: changeAt(step.resource),
          }
        : { ...step, tick: null, who: null, changeAt: [] }
    ),
  }));
}
