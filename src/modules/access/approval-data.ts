import "server-only";

import { createClient } from "@/core/supabase/server";
import { effectiveHome, moduleResources } from "@/core/modules/registry";
import { getStoredHomes } from "@/core/modules/homes";
import { ACTION_LABEL, type Action } from "@/core/rbac/types";
import {
  stageNeedsRole,
  stageRules,
  type ApprovalStageRow,
  type EngineFlow,
  type RoleOption,
} from "@/modules/access/approval-engine";
import {
  APPROVAL_FLOWS,
  type ApprovalFlow,
  type FlowStep,
} from "@/modules/access/approval-flows";
import { daysWaiting, isStuck } from "@/modules/access/waiting";

export type StepWho = {
  /** Job titles with full access ('*') — they can do every step. */
  fullAccess: { label: string; people: string[] }[];
  jobTitles: { label: string; people: string[] }[];
  /** Project roles — on the projects where someone holds them. */
  projectRoles: { department: string; role: string }[];
  /** People ticked on a department's People & Access. */
  people: { department: string; person: string }[];
  /** People who hold a stage's project role on every project in a department. */
  allProjects: { department: string; role: string; person: string }[];
  /** Department leads (for a "requester's department lead" stage). */
  leads: { department: string; person: string }[];
};

export type StepView = FlowStep & {
  /** "Module → Verb", as the tick reads in the matrices. */
  tick: string | null;
  who: StepWho | null;
  /** Where the tick is given, per the module's current home. */
  changeAt: { label: string; href: string }[];
  /** An approval stage with no usable role — only an administrator can give it. */
  needsRole?: boolean;
  /** An approval stage whose role nobody active holds, so items will get stuck. */
  nobodyHolds?: boolean;
};

export type FlowView = Omit<ApprovalFlow, "steps"> & {
  steps: StepView[];
  /** Its editable approval stages, when it is on the engine. */
  engine?: EngineFlow;
};

type Row = { role_id: string; resource: string; action: Action };
type TeamRow = { department_id: string; user_id: string; resource: string; action: Action };

/**
 * The approval flows with, for each step, who can do it right now — read from
 * the same tables the matrices write. Flows on the engine (0089) show their
 * configured stages in place of the `stages` placeholder. Nothing here is
 * consulted when access is enforced; it only describes it. RLS limits the reads
 * to access admins.
 */
export async function getApprovalFlows(): Promise<{
  flows: FlowView[];
  jobTitles: { id: string; label: string }[];
  /** Every role a stage can name, job titles first. */
  roles: RoleOption[];
}> {
  const supabase = await createClient();
  const [
    rolesRes,
    permsRes,
    teamRes,
    peopleRes,
    deptsRes,
    deptModsRes,
    leadsRes,
    allProjectsRes,
    flowsRes,
    stagesRes,
    homes,
    holdersRes,
  ] = await Promise.all([
    supabase.from("roles").select("id, label, department_id, rank").order("rank"),
    supabase.from("role_permissions").select("role_id, resource, action"),
    supabase.from("team_member_permissions").select("department_id, user_id, resource, action"),
    supabase.from("profiles").select("id, full_name, email, role_id, deactivated_at"),
    supabase.from("departments").select("id, key, label"),
    supabase.from("department_modules").select("department_id, module_id"),
    supabase.from("department_leads").select("department_id, user_id"),
    supabase
      .from("team_members")
      .select("department_id, user_id, all_projects_role_id")
      .eq("all_projects", true),
    supabase.from("approval_flows").select("id, label, has_amount, has_project"),
    supabase
      .from("approval_stages")
      .select(
        "id, flow_id, position, label, approver, role_id, skip_job_title_ids, min_amount, block_own"
      )
      .order("position"),
    getStoredHomes(),
    supabase.rpc("approval_role_holders"),
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
  const leads = (leadsRes.data ?? []) as { department_id: string; user_id: string }[];
  const allProjects = (allProjectsRes.data ?? []) as {
    department_id: string;
    user_id: string;
    all_projects_role_id: string | null;
  }[];
  const engineFlows = (flowsRes.data ?? []) as Omit<EngineFlow, "stages" | "roles">[];
  const stages = (stagesRes.data ?? []) as ApprovalStageRow[];
  const holderCount = new Map(
    ((holdersRes.data ?? []) as { stage_id: string; holders: number }[]).map((h) => [
      h.stage_id,
      h.holders,
    ])
  );

  const jobTitles = roles.filter((r) => !r.department_id);
  const titleLabel = (id: string) => jobTitles.find((t) => t.id === id)?.label ?? "a deleted job title";
  const deptLabel = new Map(depts.map((d) => [d.id, d.label]));
  // Every role a stage can name: job titles first, then each department's
  // project roles, so "Project Director" always reads with its department.
  const roleOptions: RoleOption[] = roles.map((r) => ({
    id: r.id,
    label: r.label,
    department: r.department_id ? deptLabel.get(r.department_id) ?? "—" : null,
    departmentId: r.department_id,
  }));
  const roleOption = (id: string) => roleOptions.find((r) => r.id === id) ?? null;
  const name = (p: { full_name: string | null; email: string | null; id: string }) =>
    p.full_name ?? p.email ?? p.id;
  const holders = (roleId: string) => people.filter((p) => p.role_id === roleId).map(name);
  const personName = new Map(people.map((p) => [p.id, name(p)]));
  const resources = new Map(moduleResources().map((r) => [r.id, r]));
  const has = (roleId: string, resource: string, action: Action) =>
    perms.some(
      (p) => p.role_id === roleId && p.action === action && (p.resource === resource || p.resource === "*")
    );
  const wildcardFor = (action: Action | null) =>
    jobTitles
      .filter((r) =>
        perms.some((p) => p.role_id === r.id && p.resource === "*" && (action === null || p.action === action))
      )
      .map((r) => ({ label: r.label, people: holders(r.id) }));

  const emptyWho = (fullAccess: StepWho["fullAccess"]): StepWho => ({
    fullAccess,
    jobTitles: [],
    projectRoles: [],
    people: [],
    allProjects: [],
    leads: [],
  });

  const whoFor = (resource: string, action: Action): StepWho => {
    const wildcard = (r: { id: string }) =>
      perms.some((p) => p.role_id === r.id && p.resource === "*" && p.action === action);
    const allowsProjectRoles = resources.get(resource)?.homes?.includes("project") ?? false;
    return {
      ...emptyWho(wildcardFor(action)),
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

  const tickStep = (step: FlowStep): StepView =>
    step.resource && step.action
      ? {
          ...step,
          tick: `${resources.get(step.resource)?.label ?? step.resource} → ${ACTION_LABEL[step.action]}`,
          who: whoFor(step.resource, step.action),
          changeAt: changeAt(step.resource),
        }
      : { ...step, tick: null, who: null, changeAt: [] };

  // An engine stage as a step: the one role that may give it, its rules, and
  // who holds that role right now.
  const stageStep = (s: ApprovalStageRow): StepView => {
    const rule = stageRules(s, roleOption, titleLabel).join(" ") || undefined;
    const who = emptyWho(wildcardFor(null));

    if (s.approver === "dept_lead") {
      who.leads = leads
        .filter((l) => personName.has(l.user_id))
        .map((l) => ({
          department: deptLabel.get(l.department_id) ?? "—",
          person: personName.get(l.user_id)!,
        }));
      return {
        label: s.label,
        rule,
        tick: null,
        who,
        nobodyHolds: holderCount.get(s.id) === 0,
        changeAt: [{ label: "Access Control → department leads", href: "/access" }],
      };
    }

    const role = s.role_id ? roleOption(s.role_id) : null;
    if (role && !role.departmentId) {
      who.jobTitles = [{ label: role.label, people: holders(role.id) }];
    } else if (role) {
      // A project role is held per project, so the people who hold it on every
      // project are the only ones that can be named here.
      who.projectRoles = [{ department: role.department ?? "—", role: role.label }];
      who.allProjects = allProjects
        .filter((t) => t.all_projects_role_id === role.id && personName.has(t.user_id))
        .map((t) => ({
          department: deptLabel.get(t.department_id) ?? "—",
          role: role.label,
          person: personName.get(t.user_id)!,
        }));
    }

    return {
      label: s.label,
      rule,
      tick: null,
      who,
      needsRole: stageNeedsRole(s) || (s.role_id !== null && role === null),
      nobodyHolds: !!role && holderCount.get(s.id) === 0,
      changeAt: role?.departmentId
        ? [
            { label: "Each project → Team", href: "/projects" },
            {
              label: `${role.department} → People & Access`,
              href: `/departments/${role.departmentId}/people`,
            },
          ]
        : [{ label: "Access Control → Members", href: "/access" }],
    };
  };

  // The roles a flow's stages may name: every job title, plus — for items that
  // sit on a project — the project roles of the departments allotted that
  // module. A department that doesn't run the module has no business approving
  // it, so its roles are never offered.
  const pickableRoles = (flow: ApprovalFlow, hasProject: boolean): RoleOption[] => {
    const titles = roleOptions.filter((r) => !r.departmentId);
    if (!hasProject || !flow.module) return titles;
    const allotted = new Set(
      deptMods.filter((m) => m.module_id === flow.module).map((m) => m.department_id)
    );
    return [...titles, ...roleOptions.filter((r) => r.departmentId && allotted.has(r.departmentId))];
  };

  const flows = APPROVAL_FLOWS.map((flow): FlowView => {
    const meta = flow.engineId ? engineFlows.find((f) => f.id === flow.engineId) : undefined;
    const engine: EngineFlow | undefined = meta
      ? {
          ...meta,
          stages: stages.filter((s) => s.flow_id === meta.id),
          roles: pickableRoles(flow, meta.has_project),
        }
      : undefined;
    return {
      ...flow,
      engine,
      steps: flow.steps.flatMap((step) => {
        if (!step.stages) return [tickStep(step)];
        if (!engine || engine.stages.length === 0) {
          return [
            {
              label: "No approval stages",
              rule: "Items go straight to the next step.",
              tick: null,
              who: null,
              changeAt: [],
            },
          ];
        }
        return engine.stages.map(stageStep);
      }),
    };
  });

  return {
    flows,
    jobTitles: jobTitles.map((t) => ({ id: t.id, label: t.label })),
    roles: roleOptions,
  };
}

export type WaitingApproval = {
  id: string;
  flow_id: string;
  flow_label: string;
  item_id: string;
  project_id: string | null;
  project_label: string | null;
  /** A PO number, invoice number, vendor name… when the item has one. */
  item_ref: string | null;
  amount: number | null;
  requester_name: string | null;
  raised_at: string;
  /** When it reached the stage it is on: its last decision, or when raised. */
  waiting_since: string;
  stage_label: string;
  stage_no: number;
  stage_count: number;
  approver_label: string | null;
  /** Who can give the stage now, after "not their own" and "one stage each". */
  can_approve: string[];
  /** Full-access administrators who could step in, as a recorded override. */
  admin_backup: string[];
  /** Whole days at this stage. */
  days_waiting: number;
  /** Nobody but an administrator can give it, or it has waited too long. */
  stuck: boolean;
};

/** Every item waiting on an approval decision, oldest first. Access admins only. */
export async function listWaitingApprovals(): Promise<WaitingApproval[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("list_waiting_approvals");
  const now = Date.now();
  return ((data ?? []) as Omit<WaitingApproval, "days_waiting" | "stuck">[]).map((w) => ({
    ...w,
    days_waiting: daysWaiting(w.waiting_since, now),
    stuck: isStuck(w, now),
  }));
}

/** Where an item waiting in `flow` is decided. */
export function waitingItemHref(w: Pick<WaitingApproval, "flow_id" | "item_id" | "project_id">): string {
  const p = w.project_id ? `/projects/${w.project_id}` : null;
  switch (w.flow_id) {
    case "pettycash":
      return "/pettycash";
    case "vendor":
      return "/procurement/vendors";
    case "order":
      return p ? `${p}/orders/${w.item_id}` : "/projects";
    case "intent":
      return p ? `${p}/intents` : "/projects";
    case "budget":
      return p ? `${p}/budget` : "/projects";
    case "brief":
    case "brief_revision":
      return p ? `${p}/brief/${w.item_id}` : "/projects";
    case "invoice":
    case "payment":
    case "advance":
    case "retention_early":
      return p ? `${p}/finance` : "/projects";
    default:
      return p ?? "/projects";
  }
}
