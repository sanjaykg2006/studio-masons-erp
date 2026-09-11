"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useState, useTransition } from "react";
import {
  Briefcase,
  Building2,
  ChevronDown,
  ChevronUp,
  Lock,
  Plus,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserPlus,
  UserX,
} from "lucide-react";

import {
  type Department,
  type DepartmentLead,
  type DepartmentModule,
  type Role,
  type RolePermission,
} from "@/core/rbac/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { AccessUser } from "@/modules/access/data";
import {
  PermissionMatrix,
  grantKey,
  type AccessResource,
} from "@/modules/access/components/permission-matrix";
import {
  assignUserRole,
  createDepartment,
  createRole,
  deleteDepartment,
  deleteRole,
  deactivateUser,
  getUserAccessSummary,
  getUserDeleteBlockers,
  inviteUser,
  moveJobTitle,
  reactivateUser,
  setDepartmentLead,
  setDepartmentModule,
  setModuleGeneral,
  setPermission,
  setSkipsSeniorApproval,
} from "@/modules/access/actions";
import type { AccessSummary, DeleteBlocker } from "@/modules/access/actions";

export type { AccessResource };

type Props = {
  roles: Role[];
  permissions: RolePermission[];
  users: AccessUser[];
  resources: AccessResource[];
  departments: Department[];
  departmentModules: DepartmentModule[];
  departmentLeads: DepartmentLead[];
  generalModules: string[];
  currentUserId: string;
};

/** Sentinel for the Back Office (department-less) roles bucket (department_id = null). */
const GLOBAL = "__global__";

/** Plain-English names for the tables that can hold a person in place. */
const BLOCKER_LABEL: Record<string, string> = {
  audit_log: "activity log entries",
  error_logs: "error reports",
  projects: "projects created",
  project_members: "project memberships",
  project_briefs: "briefs",
  project_files: "uploaded files",
  project_change_requests: "change requests",
  tasks: "tasks",
  task_attachments: "task attachments",
  task_invites: "task invitations",
  rfis: "RFIs raised",
  rfi_messages: "RFI replies",
  rfi_attachments: "RFI attachments",
  procurement_budgets: "budgets",
  procurement_intents: "purchase intents",
  procurement_orders: "purchase orders",
  procurement_receipts: "goods receipts",
  procurement_vendors: "vendors added",
  inventory_assets: "company assets held",
  inventory_asset_transfers: "asset transfers",
  inventory_consumption: "material consumption records",
  finance_invoices: "invoices",
  finance_payment_requests: "payment requests",
  pettycash_entries: "petty cash entries",
  team_members: "department team memberships",
  department_leads: "department lead appointments",
};

const blockerLabel = (t: string) =>
  BLOCKER_LABEL[t] ?? t.replace(/_/g, " ");
export function AccessView({
  roles,
  permissions,
  users,
  resources,
  departments,
  departmentModules,
  departmentLeads,
  generalModules,
  currentUserId,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [newRole, setNewRole] = useState("");
  const [newDept, setNewDept] = useState("");
  const [deptId, setDeptId] = useState<string>(departments[0]?.id ?? GLOBAL);
  const [roleId, setRoleId] = useState<string | null>(null);
  const [newLead, setNewLead] = useState("");

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState("");
  // What is still attached to a person we are being asked to remove, so the
  // answer to "why can this only be deactivated?" is on screen rather than a 500.
  const [removing, setRemoving] = useState<{
    id: string;
    label: string;
    blockers: DeleteBlocker[];
  } | null>(null);
  // The whole access picture for one person, gathered from the four places it
  // lives. Read-only: every section links to the screen that edits it.
  const [viewing, setViewing] = useState<{
    label: string;
    summary: AccessSummary;
  } | null>(null);

  const isGlobal = deptId === GLOBAL;
  const generalSet = useMemo(() => new Set(generalModules), [generalModules]);

  // Roles belonging to the selected department (or the global bucket).
  const rolesInScope = roles.filter(
    (r) => (r.department_id ?? GLOBAL) === deptId
  );
  const selectedRole =
    rolesInScope.find((r) => r.id === roleId) ?? rolesInScope[0] ?? null;

  // Office Access edits ONLY back-office job titles (department-less roles), and
  // a job title's whole world is back-office (general) modules. Everything
  // project/department-specific is owned by the department itself (e.g. Design
  // settings) and its lead's Team Access — never here. So the matrix shows the
  // general modules only.
  const matrixResources = resources.filter((r) => generalSet.has(r.id));

  // Fast lookups for the global-role matrix.
  const granted = new Set(
    permissions.map((p) => grantKey(p.role_id, p.resource, p.action))
  );
  const wildcard = new Set(
    permissions
      .filter((p) => p.resource === "*")
      .map((p) => `${p.role_id}:${p.action}`)
  );

  const deptById = useMemo(
    () => new Map(departments.map((d) => [d.id, d])),
    [departments]
  );
  const userById = useMemo(
    () => new Map(users.map((u) => [u.id, u])),
    [users]
  );
  const roleLabel = (r: Role) =>
    r.department_id
      ? `${r.label} · ${deptById.get(r.department_id)?.label ?? "—"}`
      : r.label;
  const userLabel = (u: AccessUser) => u.full_name ?? u.email ?? u.id;

  // Module ids assigned to each department + leads of the selected department.
  const modulesByDept = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const dm of departmentModules) {
      if (!map.has(dm.department_id)) map.set(dm.department_id, new Set());
      map.get(dm.department_id)!.add(dm.module_id);
    }
    return map;
  }, [departmentModules]);

  const leadsOfDept = isGlobal
    ? []
    : departmentLeads.filter((l) => l.department_id === deptId);
  const leadUserIds = new Set(leadsOfDept.map((l) => l.user_id));

  /** Run a server action, surface its error, and refresh server data. */
  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) =>
    startTransition(async () => {
      setError(null);
      setNotice(null);
      const res = await fn();
      if (!res.ok) setError(res.error);
      else router.refresh();
    });

  /** Invite a new user, then clear the form and confirm on success. */
  const handleInvite = (e: FormEvent) => {
    e.preventDefault();
    const email = inviteEmail.trim();
    if (!email) return;
    startTransition(async () => {
      setError(null);
      setNotice(null);
      const res = await inviteUser(email, inviteName, inviteRole || null);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNotice(`Invitation sent to ${email}.`);
      setInviteEmail("");
      setInviteName("");
      setInviteRole("");
      router.refresh();
    });
  };

  const selectDept = (id: string) => {
    setDeptId(id);
    setRoleId(null);
    setNewLead("");
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Access Control</h1>
        <p className="text-muted-foreground">
          HR&apos;s control room. Create <strong>Back Office job titles</strong>{" "}
          (which back-office screens each can open) and assign one to each person.
          Set up departments, their modules and their lead — then each lead runs
          their own team&apos;s and projects&apos; access.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {notice && (
        <div className="rounded-md border border-emerald-500/50 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-700 dark:text-emerald-400">
          {notice}
        </div>
      )}

      {/* Back office modules --------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Back office modules</CardTitle>
          <CardDescription>
            The company-wide screens that aren&apos;t tied to any project (e.g.
            Dashboard, Activity Log). Tick a module here to make it a back-office
            screen — these are the only screens a Back Office job title can be
            given. Everything else is granted per department.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {resources.map((res) => (
              <label key={res.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={generalSet.has(res.id)}
                  disabled={pending}
                  onChange={(e) =>
                    run(() => setModuleGeneral(res.id, e.target.checked))
                  }
                />
                {res.label}
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        {/* Departments list ------------------------------------------------ */}
        <Card>
          <CardHeader>
            <CardTitle>Departments</CardTitle>
            <CardDescription>Pick a department to manage.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            <button
              type="button"
              onClick={() => selectDept(GLOBAL)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                isGlobal ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
              )}
            >
              <Briefcase className="size-3.5 text-muted-foreground" />
              Back Office
            </button>

            {departments.map((dept) => (
              <div
                key={dept.id}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                  dept.id === deptId
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50"
                )}
              >
                <button
                  type="button"
                  onClick={() => selectDept(dept.id)}
                  className="flex flex-1 items-center gap-2 text-left"
                >
                  <Building2 className="size-3.5 text-muted-foreground" />
                  {dept.label}
                  {dept.is_system && (
                    <Lock className="text-muted-foreground size-3" />
                  )}
                </button>
                {!dept.is_system && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => deleteDepartment(dept.id))}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={`Delete ${dept.label}`}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
            ))}

            <form
              className="flex gap-2 pt-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (!newDept.trim()) return;
                run(() => createDepartment(newDept));
                setNewDept("");
              }}
            >
              <Input
                value={newDept}
                onChange={(e) => setNewDept(e.target.value)}
                placeholder="New department"
                className="h-8"
              />
              <Button type="submit" size="sm" disabled={pending}>
                <Plus className="size-4" />
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="space-y-6">
          {/* Department lead + modules (per-department admin setup) -------- */}
          {!isGlobal && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ShieldCheck className="size-4" /> Department lead
                  </CardTitle>
                  <CardDescription>
                    The lead manages this department&apos;s role permissions and
                    team — and only this department&apos;s.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {leadsOfDept.length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                      No lead appointed yet.
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {leadsOfDept.map((l) => (
                        <li
                          key={l.user_id}
                          className="flex items-center justify-between rounded-md bg-accent/40 px-2 py-1.5 text-sm"
                        >
                          {userById.get(l.user_id)
                            ? userLabel(userById.get(l.user_id)!)
                            : l.user_id}
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() =>
                              run(() =>
                                setDepartmentLead(deptId, l.user_id, false)
                              )
                            }
                            className="text-muted-foreground hover:text-destructive"
                            aria-label="Remove lead"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="flex gap-2">
                    <select
                      className="border-input bg-background h-9 flex-1 rounded-md border px-2 text-sm"
                      value={newLead}
                      disabled={pending}
                      onChange={(e) => setNewLead(e.target.value)}
                      aria-label="Appoint a lead"
                    >
                      <option value="">— choose a person —</option>
                      {users
                        .filter((u) => !leadUserIds.has(u.id))
                        .map((u) => (
                          <option key={u.id} value={u.id}>
                            {userLabel(u)}
                          </option>
                        ))}
                    </select>
                    <Button
                      type="button"
                      size="sm"
                      disabled={pending || !newLead}
                      onClick={() => {
                        const uid = newLead;
                        setNewLead("");
                        run(() => setDepartmentLead(deptId, uid, true));
                      }}
                    >
                      Appoint
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>
                    Modules in {deptById.get(deptId)?.label ?? "this department"}
                  </CardTitle>
                  <CardDescription>
                    Choose which modules this department&apos;s roles can be
                    granted. General modules are always available and not listed
                    here.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {resources.filter((r) => !generalSet.has(r.id)).length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                      No department-specific modules exist yet. As business modules
                      (e.g. Projects) are added, they&apos;ll appear here.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-x-6 gap-y-2">
                      {resources
                        .filter((r) => !generalSet.has(r.id))
                        .map((res) => {
                          const included =
                            modulesByDept.get(deptId)?.has(res.id) ?? false;
                          return (
                            <label
                              key={res.id}
                              className="flex items-center gap-2 text-sm"
                            >
                              <input
                                type="checkbox"
                                className="size-4 accent-primary"
                                checked={included}
                                disabled={pending}
                                onChange={(e) =>
                                  run(() =>
                                    setDepartmentModule(
                                      deptId,
                                      res.id,
                                      e.target.checked
                                    )
                                  )
                                }
                              />
                              {res.label}
                            </label>
                          );
                        })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}

          {/* Office Access ONLY manages back-office job titles (department-less
              roles). Project/department roles are owned by each department (e.g.
              Design settings) and are never listed or deleted here — which is
              what removes the foreign-key crash from deleting an in-use role. */}
          {isGlobal && (
          <div className="grid gap-6 md:grid-cols-[220px_1fr]">
            {/* Back-office job titles ------------------------------------ */}
            <Card>
              <CardHeader>
                <CardTitle>Job titles</CardTitle>
                <CardDescription>
                  Back office job titles — assign one to each employee. Top =
                  most senior; the order decides who can approve whose claims
                  (e.g. Petty Cash senior approval).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-1">
                {rolesInScope.length === 0 && (
                  <p className="text-muted-foreground text-sm">No roles yet.</p>
                )}
                {rolesInScope.map((role, i) => (
                  <div
                    key={role.id}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                      role.id === selectedRole?.id
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-accent/50"
                    )}
                  >
                    <div className="flex flex-col">
                      <button
                        type="button"
                        disabled={pending || i === 0}
                        onClick={() => run(() => moveJobTitle(role.id, true))}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                        aria-label={`Move ${role.label} up`}
                      >
                        <ChevronUp className="size-3" />
                      </button>
                      <button
                        type="button"
                        disabled={pending || i === rolesInScope.length - 1}
                        onClick={() => run(() => moveJobTitle(role.id, false))}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                        aria-label={`Move ${role.label} down`}
                      >
                        <ChevronDown className="size-3" />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => setRoleId(role.id)}
                      className="flex flex-1 items-center gap-2 text-left"
                    >
                      {role.label}
                      {role.is_system && (
                        <Lock className="text-muted-foreground size-3" />
                      )}
                    </button>
                    {!role.is_system && (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => run(() => deleteRole(role.id))}
                        className="text-muted-foreground hover:text-destructive"
                        aria-label={`Delete ${role.label}`}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </div>
                ))}

                <form
                  className="flex gap-2 pt-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!newRole.trim()) return;
                    run(() => createRole(newRole, null));
                    setNewRole("");
                  }}
                >
                  <Input
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value)}
                    placeholder="New role"
                    className="h-8"
                  />
                  <Button type="submit" size="sm" disabled={pending}>
                    <Plus className="size-4" />
                  </Button>
                </form>
              </CardContent>
            </Card>

            {/* Permissions: global roles edited here; department roles by lead */}
            <Card>
              <CardHeader>
                <CardTitle>
                  {selectedRole
                    ? `${selectedRole.label} — permissions`
                    : "Permissions"}
                </CardTitle>
                <CardDescription>
                  Tick which back-office screens this job title can open. These
                  are independent of every project and department. System-wide
                  (★) access is managed in the database, not here.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {selectedRole && (
                  <label className="bg-accent/30 flex items-start gap-2 rounded-md border p-3 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 accent-primary"
                      checked={selectedRole.skips_senior_approval}
                      disabled={pending}
                      onChange={(e) =>
                        run(() => setSkipsSeniorApproval(selectedRole.id, e.target.checked))
                      }
                    />
                    <span>
                      <span className="font-medium">
                        Petty cash claims skip senior approval
                      </span>
                      <span className="text-muted-foreground block text-xs">
                        Claims from this job title go from the Billing check
                        straight to Accounts — for the top of the order (e.g.
                        Managing Director, Co-Founder), who have no one above
                        them to approve.
                      </span>
                    </span>
                  </label>
                )}
                {!selectedRole ? (
                  <p className="text-muted-foreground text-sm">Select a role.</p>
                ) : matrixResources.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    No back-office modules yet. Tick a module under “Back office
                    modules” above to grant it here.
                  </p>
                ) : (
                  <PermissionMatrix
                    role={selectedRole}
                    resources={matrixResources}
                    granted={granted}
                    wildcard={wildcard}
                    generalSet={generalSet}
                    disabled={pending}
                    onToggle={(resource, action, checked) =>
                      run(() =>
                        setPermission(selectedRole.id, resource, action, checked)
                      )
                    }
                  />
                )}
              </CardContent>
            </Card>
          </div>
          )}
        </div>
      </div>

      {/* Members --------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>
            Invite people, assign each a role, and remove those who leave.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Invite a new user ------------------------------------------- */}
          <form
            onSubmit={handleInvite}
            className="flex flex-col gap-2 sm:flex-row sm:items-center"
          >
            <Input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="name@studio-masons.com"
              className="h-9 sm:flex-1"
              aria-label="Invite email"
            />
            <Input
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
              placeholder="Full name (optional)"
              className="h-9 sm:flex-1"
              aria-label="Invite full name"
            />
            <select
              className="border-input bg-background h-9 rounded-md border px-2"
              value={inviteRole}
              disabled={pending}
              onChange={(e) => setInviteRole(e.target.value)}
              aria-label="Invite role"
            >
              <option value="">— no role —</option>
              {roles
                .filter((r) => !r.department_id)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
            </select>
            <Button type="submit" size="sm" disabled={pending}>
              <UserPlus className="size-4" /> Invite
            </Button>
          </form>

          {/* Existing members ------------------------------------------- */}
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-b text-left">
                <th className="py-2 font-medium">User</th>
                <th className="py-2 font-medium">Role</th>
                <th className="py-2 text-right font-medium">Access</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b last:border-0">
                  <td className={cn("py-2", u.deactivated_at && "text-muted-foreground")}>
                    {userLabel(u)}
                    {u.deactivated_at && (
                      <span className="text-muted-foreground bg-muted ml-2 rounded px-1.5 py-0.5 text-xs">
                        Inactive
                      </span>
                    )}
                  </td>
                  <td className="py-2">
                    <select
                      className="border-input bg-background h-8 rounded-md border px-2"
                      value={u.role_id ?? ""}
                      disabled={pending}
                      onChange={(e) =>
                        run(() => assignUserRole(u.id, e.target.value || null))
                      }
                    >
                      <option value="">— none —</option>
                      {/* Back-office job titles only; keep any legacy department
                          role already assigned so it stays visible and editable. */}
                      {roles
                        .filter((r) => !r.department_id || r.id === u.role_id)
                        .map((r) => (
                          <option key={r.id} value={r.id}>
                            {roleLabel(r)}
                          </option>
                        ))}
                    </select>
                  </td>
                  <td className="py-2 text-right">
                    <button
                      type="button"
                      onClick={async () => {
                        const res = await getUserAccessSummary(u.id);
                        if (!res.ok) {
                          setError(res.error);
                          return;
                        }
                        setViewing({ label: userLabel(u), summary: res.summary });
                      }}
                      className="text-muted-foreground hover:text-foreground mr-3 inline-flex items-center gap-1 text-xs"
                      aria-label={`View access for ${u.email ?? u.id}`}
                    >
                      <ShieldCheck className="size-3.5" /> View access
                    </button>
                    {u.id === currentUserId ? (
                      <span className="text-muted-foreground/50 text-xs">you</span>
                    ) : u.deactivated_at ? (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => run(() => reactivateUser(u.id))}
                        className="text-muted-foreground hover:text-emerald-600 inline-flex items-center gap-1 text-xs"
                        aria-label={`Reactivate ${u.email ?? u.id}`}
                      >
                        <UserCheck className="size-3.5" /> Reactivate
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={async () => {
                          // Ask the database what is holding them BEFORE
                          // offering a choice, so the reason is specific.
                          const res = await getUserDeleteBlockers(u.id);
                          if (!res.ok) {
                            setError(res.error);
                            return;
                          }
                          setRemoving({
                            id: u.id,
                            label: userLabel(u),
                            blockers: res.blockers,
                          });
                        }}
                        className="text-muted-foreground hover:text-destructive inline-flex items-center gap-1 text-xs"
                        aria-label={`Remove ${u.email ?? u.id}`}
                      >
                        <UserX className="size-3.5" /> Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* One person's whole access, gathered from the four places it lives --- */}
      {viewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="max-h-[85vh] w-full max-w-2xl overflow-y-auto">
            <CardHeader>
              <CardTitle className="text-base">Access · {viewing.label}</CardTitle>
              <CardDescription>
                Everything that decides what this person can do. Read-only —
                each part is changed on the screen that owns it, so there is only
                ever one copy of a rule.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5 text-sm">
              {/* Plane 1 ------------------------------------------------- */}
              <section>
                <h4 className="mb-1 font-medium">Job title</h4>
                {viewing.summary.role ? (
                  <p className="text-muted-foreground">
                    {viewing.summary.role.label}
                    {viewing.summary.role.is_system && " · system role"}
                    {" · "}
                    {viewing.summary.role.permissions.length} grant
                    {viewing.summary.role.permissions.length === 1 ? "" : "s"}
                  </p>
                ) : (
                  <p className="text-muted-foreground">
                    No job title — no company-wide access at all.
                  </p>
                )}
              </section>

              {/* Plane 2 ------------------------------------------------- */}
              <section>
                <h4 className="mb-1 font-medium">Department teams</h4>
                {viewing.summary.teams.length === 0 ? (
                  <p className="text-muted-foreground">On no department team.</p>
                ) : (
                  <ul className="space-y-1">
                    {viewing.summary.teams.map((t) => (
                      <li key={t.department} className="text-muted-foreground">
                        <span className="text-foreground">{t.department}</span>
                        {t.is_lead && " · lead"}
                        {" · "}
                        {t.permissions.length} grant
                        {t.permissions.length === 1 ? "" : "s"}
                        {t.all_projects && (
                          <span className="text-foreground">
                            {" · works on all projects as "}
                            {t.all_projects_role ?? "(no role set)"}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Plane 3 ------------------------------------------------- */}
              <section>
                <h4 className="mb-1 font-medium">Projects</h4>
                {viewing.summary.projects.length === 0 ? (
                  <p className="text-muted-foreground">
                    Not a member of any project.
                    {viewing.summary.teams.some((t) => t.all_projects)
                      ? " The all-projects switch above reaches them instead."
                      : ""}
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {viewing.summary.projects.map((pr) => (
                      <li key={pr.id} className="text-muted-foreground">
                        <span className="text-foreground">{pr.name}</span>
                        {pr.code ? ` (${pr.code})` : ""} · as {pr.role}
                        {" · owned by "}
                        {pr.owner_department ?? "—"}
                        {pr.phase === "concept" && " · still in Concept"}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* The union the app enforces company-wide ----------------- */}
              <section>
                <h4 className="mb-1 font-medium">
                  Company-wide permissions ({viewing.summary.effective.length})
                </h4>
                <p className="text-muted-foreground mb-2 text-xs">
                  Job title and team grants combined — the same union the
                  database checks. Project work is granted per project above.
                </p>
                {viewing.summary.effective.length === 0 ? (
                  <p className="text-muted-foreground">None.</p>
                ) : (
                  <div className="max-h-56 overflow-y-auto">
                    <table className="w-full text-xs">
                      <tbody>
                        {viewing.summary.effective.map((e, n) => (
                          <tr key={n} className="border-b last:border-0">
                            <td className="py-1 font-mono">{e.resource}</td>
                            <td className="py-1">{e.action}</td>
                            <td className="text-muted-foreground py-1 text-right">
                              {e.via}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <div className="flex justify-end">
                <Button size="sm" variant="outline" onClick={() => setViewing(null)}>
                  Close
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
      {/* Why this person can only be deactivated ------------------------- */}
      {removing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="max-h-[80vh] w-full max-w-lg overflow-y-auto">
            <CardHeader>
              <CardTitle className="text-base">Remove {removing.label}</CardTitle>
              <CardDescription>
                {removing.blockers.length === 0
                  ? "Nothing is attached to this person, so they can be deleted outright."
                  : "Their name is still on the records below, so the database will not delete them. Deactivating blocks their login and keeps the history intact."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {removing.blockers.length > 0 && (
                <ul className="space-y-1 text-sm">
                  {removing.blockers.map((b) => (
                    <li
                      key={`${b.table_name}.${b.column_name}`}
                      className="flex items-center justify-between gap-4 border-b pb-1 last:border-0"
                    >
                      <span>{blockerLabel(b.table_name)}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {b.row_count}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {removing.blockers.length > 0 && (
                <p className="text-muted-foreground text-xs">
                  Clear these and the delete will go through. Be deliberate about
                  it: reassigning is fine, but removing approvals or log entries
                  rewrites what actually happened.
                </p>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setRemoving(null)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={pending}
                  onClick={() => {
                    const id = removing.id;
                    setRemoving(null);
                    run(() => deactivateUser(id));
                  }}
                >
                  {removing.blockers.length === 0
                    ? "Delete permanently"
                    : "Deactivate instead"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}