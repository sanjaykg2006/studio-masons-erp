"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useState, useTransition } from "react";
import {
  Building2,
  Globe,
  Lock,
  Plus,
  ShieldCheck,
  Trash2,
  UserPlus,
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
  inviteUser,
  removeUser,
  setDepartmentLead,
  setDepartmentModule,
  setModuleGeneral,
  setPermission,
} from "@/modules/access/actions";

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

/** Sentinel for the "Global / system roles" pseudo-department (department_id = null). */
const GLOBAL = "__global__";

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

  const isGlobal = deptId === GLOBAL;
  const generalSet = useMemo(() => new Set(generalModules), [generalModules]);

  // Roles belonging to the selected department (or the global bucket).
  const rolesInScope = roles.filter(
    (r) => (r.department_id ?? GLOBAL) === deptId
  );
  const selectedRole =
    rolesInScope.find((r) => r.id === roleId) ?? rolesInScope[0] ?? null;

  // What the admin edits here:
  //  * Global/system roles → every module (they can hold anything).
  //  * Department roles → GENERAL/shared modules only. The department's OWN
  //    modules are the lead's job on Team Access; general access stays admin's.
  const matrixResources = isGlobal
    ? resources
    : resources.filter((r) => generalSet.has(r.id));

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
          Create roles and departments, choose each department&apos;s modules and
          lead, and invite people. Each department&apos;s lead sets their own
          roles&apos; permissions on their Team Access page.
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

      {/* General modules ------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>General modules</CardTitle>
          <CardDescription>
            General modules appear in every role&apos;s permission matrix,
            regardless of department. Everything else is granted per department.
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
              <Globe className="size-3.5 text-muted-foreground" />
              Global / system
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

          <div className="grid gap-6 md:grid-cols-[220px_1fr]">
            {/* Roles in scope -------------------------------------------- */}
            <Card>
              <CardHeader>
                <CardTitle>Roles</CardTitle>
                <CardDescription>
                  {isGlobal
                    ? "Global / system roles."
                    : "Roles in this department."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-1">
                {rolesInScope.length === 0 && (
                  <p className="text-muted-foreground text-sm">No roles yet.</p>
                )}
                {rolesInScope.map((role) => (
                  <div
                    key={role.id}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                      role.id === selectedRole?.id
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-accent/50"
                    )}
                  >
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
                    run(() => createRole(newRole, isGlobal ? null : deptId));
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
                  {isGlobal
                    ? "Tick an action to grant it. System-wide (★) access is managed in the database, not here."
                    : "General/shared access only — tick to grant. This department's own modules are managed by its lead on Team Access."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!selectedRole ? (
                  <p className="text-muted-foreground text-sm">Select a role.</p>
                ) : matrixResources.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    {isGlobal
                      ? "No modules yet."
                      : "No general modules yet. Mark a module as general above to grant it to this department's roles here."}
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
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {roleLabel(r)}
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
                <th className="py-2 text-right font-medium">Remove</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b last:border-0">
                  <td className="py-2">{userLabel(u)}</td>
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
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {roleLabel(r)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 text-right">
                    {u.id === currentUserId ? (
                      <span className="text-muted-foreground/50 text-xs">you</span>
                    ) : (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => {
                          if (
                            confirm(
                              `Remove ${userLabel(u)}? This permanently deletes their account.`
                            )
                          ) {
                            run(() => removeUser(u.id));
                          }
                        }}
                        className="text-muted-foreground hover:text-destructive"
                        aria-label={`Remove ${u.email ?? u.id}`}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
