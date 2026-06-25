"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Trash2, UserPlus } from "lucide-react";

import {
  ACTIONS,
  ACTION_LABEL,
  type Action,
  type Department,
  type DepartmentModule,
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
import type { AccessResource } from "@/modules/access/components/permission-matrix";
import type { TeamGrant, TeamMember, TeamRole } from "@/modules/team-access/data";
import {
  addTeamMember,
  removeTeamMember,
  setTeamMemberAllProjects,
  setTeamMemberPermission,
} from "@/modules/team-access/actions";

type Props = {
  departments: Department[];
  departmentModules: DepartmentModule[];
  members: TeamMember[];
  grants: TeamGrant[];
  people: AccessUser[];
  roles: TeamRole[];
  resources: AccessResource[];
  generalModules: string[];
};

const cellKey = (userId: string, resource: string, action: Action) =>
  `${userId}:${resource}:${action}`;

/**
 * A department lead's self-service page — PER PERSON. Pick a teammate, tick what
 * they can do. Their grants apply across the whole department (every project in
 * it). People who should only see specific projects are added inside those
 * projects instead. The database (RLS + the 0015 RPCs) is the real boundary.
 */
export function TeamAccessView({
  departments,
  departmentModules,
  members,
  grants,
  people,
  roles,
  resources,
  generalModules,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [deptId, setDeptId] = useState<string>(departments[0]?.id ?? "");
  const [userId, setUserId] = useState<string | null>(null);
  const [addUser, setAddUser] = useState("");

  const generalSet = useMemo(() => new Set(generalModules), [generalModules]);
  const peopleById = useMemo(
    () => new Map(people.map((p) => [p.id, p])),
    [people]
  );
  const userLabel = (id: string) => {
    const u = peopleById.get(id);
    return u?.full_name ?? u?.email ?? id;
  };

  // This department's own modules (never the general/back-office ones).
  const deptModuleIds = useMemo(
    () =>
      new Set(
        departmentModules
          .filter((dm) => dm.department_id === deptId)
          .map((dm) => dm.module_id)
      ),
    [departmentModules, deptId]
  );
  const matrixResources = resources.filter(
    (r) => deptModuleIds.has(r.id) && !generalSet.has(r.id)
  );

  const membersInDept = members.filter((m) => m.department_id === deptId);
  const memberIds = membersInDept.map((m) => m.user_id);
  const selectedUserId =
    userId && memberIds.includes(userId) ? userId : memberIds[0] ?? null;
  const selectedMember =
    membersInDept.find((m) => m.user_id === selectedUserId) ?? null;
  const rolesInDept = roles.filter((r) => r.department_id === deptId);

  const granted = new Set(
    grants
      .filter((g) => g.department_id === deptId)
      .map((g) => cellKey(g.user_id, g.resource, g.action))
  );

  const assignablePeople = people.filter((p) => !memberIds.includes(p.id));

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error);
      else router.refresh();
    });

  const selectDept = (id: string) => {
    setDeptId(id);
    setUserId(null);
  };

  const currentDept = departments.find((d) => d.id === deptId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Team Access</h1>
        <p className="text-muted-foreground">
          Pick a teammate and set their department-level access — managing the
          template library, creating projects, editing settings. Work on actual
          projects is given by project roles (inside each project). Use the
          &ldquo;works on all projects&rdquo; switch for seniors who should reach
          every project at once. You only ever see your own department.
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

      <div className="grid gap-6 md:grid-cols-[240px_1fr]">
        {/* People in this department -------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle>People</CardTitle>
            <CardDescription>
              {currentDept ? `${currentDept.label} team.` : "Your team."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {memberIds.length === 0 && (
              <p className="text-muted-foreground text-sm">No one added yet.</p>
            )}
            {memberIds.map((id) => (
              <div
                key={id}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                  id === selectedUserId
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50"
                )}
              >
                <button
                  type="button"
                  onClick={() => setUserId(id)}
                  className="flex-1 text-left"
                >
                  {userLabel(id)}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    if (confirm(`Remove ${userLabel(id)} from this team?`))
                      run(() => removeTeamMember(deptId, id));
                  }}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`Remove ${userLabel(id)}`}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}

            <div className="flex gap-2 pt-3">
              <select
                className="border-input bg-background h-8 flex-1 rounded-md border px-2 text-sm"
                value={addUser}
                disabled={pending}
                onChange={(e) => setAddUser(e.target.value)}
                aria-label="Add a person"
              >
                <option value="">— add a person —</option>
                {assignablePeople.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.full_name ?? u.email ?? u.id}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                size="sm"
                disabled={pending || !addUser}
                onClick={() => {
                  const uid = addUser;
                  setAddUser("");
                  run(() => addTeamMember(deptId, uid));
                }}
              >
                <UserPlus className="size-4" />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Selected person's permissions ---------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle>
              {selectedUserId
                ? `${userLabel(selectedUserId)} — what they can do`
                : "Permissions"}
            </CardTitle>
            <CardDescription>
              Tick a department-level action to grant it (e.g. manage templates,
              create projects, edit settings). Work on individual projects is set
              by project roles instead.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Works on all projects ------------------------------------- */}
            {selectedUserId && selectedMember && (
              <div className="bg-accent/30 space-y-2 rounded-md border p-3">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={selectedMember.all_projects}
                    disabled={pending}
                    onChange={(e) =>
                      run(() =>
                        setTeamMemberAllProjects(
                          deptId,
                          selectedUserId,
                          e.target.checked,
                          e.target.checked
                            ? selectedMember.all_projects_role_id ??
                                rolesInDept[0]?.id ??
                                null
                            : null
                        )
                      )
                    }
                  />
                  Works on all projects
                </label>
                {selectedMember.all_projects && (
                  <div className="flex items-center gap-2 pl-6 text-sm">
                    <span className="text-muted-foreground">as</span>
                    <select
                      className="border-input bg-background h-8 rounded-md border px-2"
                      value={selectedMember.all_projects_role_id ?? ""}
                      disabled={pending}
                      onChange={(e) =>
                        run(() =>
                          setTeamMemberAllProjects(
                            deptId,
                            selectedUserId,
                            true,
                            e.target.value || null
                          )
                        )
                      }
                      aria-label="Role applied on all projects"
                    >
                      <option value="">— pick a project role —</option>
                      {rolesInDept.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                    <span className="text-muted-foreground">
                      on every project
                    </span>
                  </div>
                )}
              </div>
            )}

            {!selectedUserId ? (
              <p className="text-muted-foreground text-sm">
                Add a person, then pick them to set their permissions.
              </p>
            ) : matrixResources.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No modules are assigned to your department yet — ask an admin to
                add them in Access Control.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-muted-foreground border-b text-left">
                      <th className="py-2 font-medium">Module</th>
                      {ACTIONS.map((a) => (
                        <th key={a} className="px-2 py-2 text-center font-medium">
                          {ACTION_LABEL[a]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {matrixResources.map((res) => (
                      <tr key={res.id} className="border-b last:border-0">
                        <td className="py-2 font-medium">{res.label}</td>
                        {ACTIONS.map((action) => {
                          const checked = granted.has(
                            cellKey(selectedUserId, res.id, action)
                          );
                          return (
                            <td key={action} className="py-2 text-center">
                              <input
                                type="checkbox"
                                className="size-4 accent-primary"
                                checked={checked}
                                disabled={pending}
                                onChange={(e) =>
                                  run(() =>
                                    setTeamMemberPermission(
                                      deptId,
                                      selectedUserId,
                                      res.id,
                                      action,
                                      e.target.checked
                                    )
                                  )
                                }
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
