"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Trash2, UserPlus } from "lucide-react";

import type {
  Department,
  DepartmentModule,
  Role,
  RolePermission,
} from "@/core/rbac/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AccessUser } from "@/modules/access/data";
import {
  PermissionMatrix,
  grantKey,
  type AccessResource,
} from "@/modules/access/components/permission-matrix";
import {
  assignTeamMember,
  removeTeamMember,
  setTeamPermission,
  setTeamRoleWide,
} from "@/modules/team-access/actions";

type Props = {
  departments: Department[];
  roles: Role[];
  permissions: RolePermission[];
  departmentModules: DepartmentModule[];
  members: AccessUser[];
  resources: AccessResource[];
  generalModules: string[];
};

export function TeamAccessView({
  departments,
  roles,
  permissions,
  departmentModules,
  members,
  resources,
  generalModules,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [deptId, setDeptId] = useState<string>(departments[0]?.id ?? "");
  const [roleId, setRoleId] = useState<string | null>(null);
  const [addUser, setAddUser] = useState("");
  const [addRole, setAddRole] = useState("");

  const generalSet = useMemo(() => new Set(generalModules), [generalModules]);

  // Modules assigned to the selected department (lead-editable, minus general).
  const deptModuleIds = useMemo(
    () =>
      new Set(
        departmentModules
          .filter((dm) => dm.department_id === deptId)
          .map((dm) => dm.module_id)
      ),
    [departmentModules, deptId]
  );

  const rolesInDept = roles.filter((r) => r.department_id === deptId);
  const selectedRole =
    rolesInDept.find((r) => r.id === roleId) ?? rolesInDept[0] ?? null;
  const roleIdsInDept = new Set(rolesInDept.map((r) => r.id));

  // Matrix rows: this department's own modules (never general), in registry order.
  const matrixResources = resources.filter(
    (r) => deptModuleIds.has(r.id) && !generalSet.has(r.id)
  );

  const granted = new Set(
    permissions.map((p) => grantKey(p.role_id, p.resource, p.action))
  );
  const wildcard = new Set(
    permissions
      .filter((p) => p.resource === "*")
      .map((p) => `${p.role_id}:${p.action}`)
  );

  const userLabel = (u: AccessUser) => u.full_name ?? u.email ?? u.id;
  const membersInDept = members.filter(
    (u) => u.role_id && roleIdsInDept.has(u.role_id)
  );
  const assignableUsers = members.filter(
    (u) => !u.role_id || !roleIdsInDept.has(u.role_id)
  );

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error);
      else router.refresh();
    });

  const selectDept = (id: string) => {
    setDeptId(id);
    setRoleId(null);
  };

  const currentDept = departments.find((d) => d.id === deptId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Team Access</h1>
        <p className="text-muted-foreground">
          Set what each of your department&apos;s roles can do, and assign your
          people to them. You only ever see your own department.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Department switcher (only when leading more than one) ------------- */}
      {departments.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {departments.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => selectDept(d.id)}
              className={cn(
                "rounded-md border px-3 py-1.5 text-sm",
                d.id === deptId
                  ? "bg-accent text-accent-foreground border-accent"
                  : "hover:bg-accent/50"
              )}
            >
              {d.label}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-[220px_1fr]">
        {/* Roles in this department (read-only set — admin creates them) --- */}
        <Card>
          <CardHeader>
            <CardTitle>Roles</CardTitle>
            <CardDescription>
              {currentDept ? `${currentDept.label} roles.` : "Your roles."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {rolesInDept.length === 0 && (
              <p className="text-muted-foreground text-sm">
                No roles yet — ask an admin to add roles to your department.
              </p>
            )}
            {rolesInDept.map((role) => (
              <button
                key={role.id}
                type="button"
                onClick={() => setRoleId(role.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                  role.id === selectedRole?.id
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50"
                )}
              >
                {role.label}
              </button>
            ))}
          </CardContent>
        </Card>

        {/* Permission matrix for the selected role ----------------------- */}
        <Card>
          <CardHeader>
            <CardTitle>
              {selectedRole
                ? `${selectedRole.label} — permissions`
                : "Permissions"}
            </CardTitle>
            <CardDescription>
              Tick an action to grant it. Only your department&apos;s modules are
              shown.
            </CardDescription>
            {selectedRole && (
              <label
                className="mt-2 flex items-center gap-2 text-sm"
                title="Department-wide roles see every project; otherwise access is per-project membership."
              >
                <input
                  type="checkbox"
                  className="accent-primary size-4"
                  checked={selectedRole.is_department_wide}
                  disabled={pending}
                  onChange={(e) =>
                    run(() => setTeamRoleWide(selectedRole.id, e.target.checked))
                  }
                />
                Sees all projects in the department{" "}
                <span className="text-muted-foreground">
                  (otherwise only projects they&apos;re added to)
                </span>
              </label>
            )}
          </CardHeader>
          <CardContent>
            {!selectedRole ? (
              <p className="text-muted-foreground text-sm">Select a role.</p>
            ) : matrixResources.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No modules are assigned to your department yet — ask an admin to
                add them in Access Control.
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
                    setTeamPermission(selectedRole.id, resource, action, checked)
                  )
                }
              />
            )}
          </CardContent>
        </Card>
      </div>

      {/* People in this department -------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>People</CardTitle>
          <CardDescription>
            Put your team members into the right role, or remove them from the
            department.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Add someone --------------------------------------------- */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <select
              className="border-input bg-background h-9 rounded-md border px-2 text-sm sm:flex-1"
              value={addUser}
              disabled={pending}
              onChange={(e) => setAddUser(e.target.value)}
              aria-label="Choose a person"
            >
              <option value="">— choose a person —</option>
              {assignableUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {userLabel(u)}
                </option>
              ))}
            </select>
            <select
              className="border-input bg-background h-9 rounded-md border px-2 text-sm sm:flex-1"
              value={addRole}
              disabled={pending}
              onChange={(e) => setAddRole(e.target.value)}
              aria-label="Choose a role"
            >
              <option value="">— choose a role —</option>
              {rolesInDept.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
            <Button
              type="button"
              size="sm"
              disabled={pending || !addUser || !addRole}
              onClick={() => {
                const uid = addUser;
                const rid = addRole;
                setAddUser("");
                setAddRole("");
                run(() => assignTeamMember(uid, rid));
              }}
            >
              <UserPlus className="size-4" /> Add
            </Button>
          </div>

          {/* Current team ------------------------------------------- */}
          {membersInDept.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No one is in this department yet.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left">
                  <th className="py-2 font-medium">Person</th>
                  <th className="py-2 font-medium">Role</th>
                  <th className="py-2 text-right font-medium">Remove</th>
                </tr>
              </thead>
              <tbody>
                {membersInDept.map((u) => (
                  <tr key={u.id} className="border-b last:border-0">
                    <td className="py-2">{userLabel(u)}</td>
                    <td className="py-2">
                      <select
                        className="border-input bg-background h-8 rounded-md border px-2"
                        value={u.role_id ?? ""}
                        disabled={pending}
                        onChange={(e) =>
                          run(() => assignTeamMember(u.id, e.target.value))
                        }
                      >
                        {rolesInDept.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => run(() => removeTeamMember(u.id))}
                        className="text-muted-foreground hover:text-destructive"
                        aria-label={`Remove ${userLabel(u)}`}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
