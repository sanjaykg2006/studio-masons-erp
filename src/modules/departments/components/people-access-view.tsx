"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ArrowLeft, Trash2, UserPlus } from "lucide-react";

import { ACTIONS, ACTION_LABEL, type Action } from "@/core/rbac/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AccessResource } from "@/modules/access/components/permission-matrix";
import { DEPARTMENT_HOME } from "@/modules/departments/home";
import type { MyDepartment } from "@/modules/departments/data";
import type {
  SubteamMembership,
  SubteamRef,
} from "@/modules/departments/people-data";
import type { TeamGrant, TeamMember, TeamRole } from "@/modules/team-access/data";
import type { AccessUser } from "@/modules/access/data";
import {
  addTeamMember,
  removeTeamMember,
  setTeamMemberAllProjects,
  setTeamMemberPermission,
} from "@/modules/team-access/actions";
import { setSubteamMember } from "@/modules/departments/actions";

type Props = {
  department: MyDepartment;
  members: TeamMember[];
  grants: TeamGrant[];
  people: AccessUser[];
  roles: TeamRole[];
  resources: AccessResource[];
  subteams: SubteamRef[];
  subteamMembers: SubteamMembership[];
};

const cellKey = (userId: string, resource: string, action: Action) =>
  `${userId}:${resource}:${action}`;

/**
 * The ONE place to run a department's people: add/remove teammates, give each
 * their role across the department, put them in Concept/Technical, and tick any
 * extra department abilities. Replaces the separate Team Access page for this
 * department. The database (RLS + RPCs) is the real boundary on every change.
 */
export function PeopleAccessView({
  department,
  members,
  grants,
  people,
  roles,
  resources,
  subteams,
  subteamMembers,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const deptId = department.id;
  const [userId, setUserId] = useState<string | null>(null);
  const [addUser, setAddUser] = useState("");

  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const userLabel = (id: string) => {
    const u = peopleById.get(id);
    return u?.full_name ?? u?.email ?? id;
  };

  const memberIds = members.map((m) => m.user_id);
  const selectedUserId =
    userId && memberIds.includes(userId) ? userId : memberIds[0] ?? null;
  const selectedMember =
    members.find((m) => m.user_id === selectedUserId) ?? null;

  const granted = new Set(
    grants.map((g) => cellKey(g.user_id, g.resource, g.action))
  );
  const inSubteam = new Set(
    subteamMembers.map((s) => `${s.subteam_id}:${s.user_id}`)
  );
  const assignablePeople = people.filter((p) => !memberIds.includes(p.id));

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error);
      else router.refresh();
    });

  return (
    <div className="space-y-6">
      <Link
        href={DEPARTMENT_HOME[department.key] ?? `/departments/${deptId}`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" /> {department.label}
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">People &amp; Access</h1>
        <p className="text-muted-foreground text-sm">
          Everyone in {department.label}. Pick a person to put them in a sub-team,
          give them a role on every project, and tick what they can do inside the
          department. What a role can do on a project is set in Settings → Project
          roles; company-wide screens come with the job title in Access Control.
        </p>
      </div>

      {error && (
        <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-md border px-4 py-2 text-sm">
          {error}
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-[240px_1fr]">
        {/* People in this department -------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle>People</CardTitle>
            <CardDescription>{department.label} team.</CardDescription>
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

        {/* Selected person -------------------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle>
              {selectedUserId
                ? userLabel(selectedUserId)
                : "Pick a person"}
            </CardTitle>
            <CardDescription>
              Their role and abilities in {department.label}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {!selectedUserId || !selectedMember ? (
              <p className="text-muted-foreground text-sm">
                Add a person on the left, then pick them here.
              </p>
            ) : (
              <>
                {/* Role across the department ----------------------------- */}
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
                                  roles[0]?.id ??
                                  null
                              : null
                          )
                        )
                      }
                    />
                    Give this person a role on every project
                  </label>
                  {selectedMember.all_projects && (
                    <div className="flex flex-wrap items-center gap-2 pl-6 text-sm">
                      <span className="text-muted-foreground">Role:</span>
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
                        aria-label="Role on every project"
                      >
                        <option value="">— pick a role —</option>
                        {roles.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                      <span className="text-muted-foreground">on every project</span>
                    </div>
                  )}
                  <p className="text-muted-foreground pl-6 text-xs">
                    Leave this off to give them a role on individual projects only
                    (done inside each project).
                  </p>
                </div>

                {/* Sub-teams (e.g. Concept / Technical) ------------------- */}
                {subteams.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Sub-teams</p>
                    <div className="flex flex-wrap gap-x-6 gap-y-2">
                      {subteams.map((s) => (
                        <label key={s.id} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="size-4 accent-primary"
                            checked={inSubteam.has(`${s.id}:${selectedUserId}`)}
                            disabled={pending}
                            onChange={(e) =>
                              run(() =>
                                setSubteamMember(
                                  deptId,
                                  s.id,
                                  selectedUserId,
                                  e.target.checked
                                )
                              )
                            }
                          />
                          {s.label}
                        </label>
                      ))}
                    </div>
                    <p className="text-muted-foreground text-xs">
                      Sub-teams keep their tasks private from each other.
                    </p>
                  </div>
                )}

                {/* What they can do inside the department ----------------- */}
                <div className="space-y-2">
                  <p className="text-sm font-medium">
                    What they can do in {department.label}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    The lead can always do all of this. Only the lead can hand out
                    Settings or People &amp; Access.
                    {resources.some((r) => r.id === "access") &&
                      " Only a full-access Administrator can hand out Access Control — it lets the holder change anyone's access, their own included."}
                  </p>
                  {resources.length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                      Nothing to grant yet.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-muted-foreground border-b text-left">
                            <th className="py-2 font-medium">Area</th>
                            {ACTIONS.map((a) => (
                              <th key={a} className="px-2 py-2 text-center font-medium">
                                {ACTION_LABEL[a]}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {resources.map((res) => (
                            <tr key={res.id} className="border-b last:border-0">
                              <td className="py-2 font-medium">{res.label}</td>
                              {ACTIONS.map((action) => {
                                if (!res.actions.includes(action)) {
                                  return <td key={action} />;
                                }
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
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
