"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowLeft, FileText, Lock, Snowflake, Trash2, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DISCIPLINE_LABEL, type Discipline } from "@/modules/projects/types";
import type {
  AssignableUser,
  DesignRole,
  ProjectBriefRow,
  ProjectMemberView,
} from "@/modules/design/data";
import type {
  DesignChangeRequest,
  DesignProject,
  ProjectFolder,
  ProjectProgress,
} from "@/modules/projects/types";
import {
  addMember,
  createBriefs,
  deleteProject,
  finaliseProject,
  freezeProject,
  removeMember,
  unfreezeProject,
} from "@/modules/design/actions";
import {
  BriefStatusBadge,
  ProjectPhaseBadge,
  ProjectStatusBadge,
} from "@/modules/design/components/status-badge";
import { ProgressTracker } from "@/modules/design/components/progress-tracker";
import { FoldersCard } from "@/modules/design/components/folders-card";
import { ChangeRequestsCard } from "@/modules/design/components/change-requests-card";
import { RfiCard } from "@/modules/design/components/rfi-card";
import type { DepartmentRef, RfiRow } from "@/modules/design/rfi-types";

type Props = {
  project: DesignProject;
  progress: ProjectProgress;
  folders: ProjectFolder[];
  changeRequests: DesignChangeRequest[];
  rfis: RfiRow[];
  rfiDepartments: DepartmentRef[];
  canDecideChanges: boolean;
  members: ProjectMemberView[];
  briefs: ProjectBriefRow[];
  roleLabels: Record<string, string>;
  users: AssignableUser[];
  roles: DesignRole[];
  templates: { id: string; label: string; discipline: Discipline; version_id: string }[];
  canUpdate: boolean;
  canDelete: boolean;
  canFinalise: boolean;
  canFreeze: boolean;
  canManageMembers: boolean;
  canCreateBrief: boolean;
};

export function ProjectDetail({
  project,
  progress,
  folders,
  changeRequests,
  rfis,
  rfiDepartments,
  canDecideChanges,
  members,
  briefs,
  roleLabels,
  users,
  roles,
  templates,
  canUpdate,
  canDelete,
  canFinalise,
  canFreeze,
  canManageMembers,
  canCreateBrief,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [memberUser, setMemberUser] = useState("");
  const [memberRole, setMemberRole] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error);
      else router.refresh();
    });

  const usedTemplates = new Set(briefs.map((b) => b.template_id));
  const available = templates.filter((t) => !usedTemplates.has(t.id));
  const memberIds = new Set(members.map((m) => m.user_id));
  const addableUsers = users.filter((u) => !memberIds.has(u.id));

  const togglePick = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-6">
      <Link
        href="/projects"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" /> All projects
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
            <ProjectPhaseBadge phase={project.phase} />
            <ProjectStatusBadge status={project.status} />
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            {[project.code, project.client, project.location].filter(Boolean).join(" · ") || "No details yet."}
          </p>
        </div>
        <div className="flex gap-2">
          {canFreeze && project.phase === "concept" && (
            <Button
              size="sm"
              disabled={pending}
              onClick={() => {
                if (
                  confirm(
                    "Design Freeze: hand this project to the Execution phase? " +
                      "It opens up to all assigned teams and the design locks — " +
                      "further changes must go through change orders."
                  )
                )
                  run(() => freezeProject(project.id));
              }}
            >
              <Snowflake className="size-4" /> Design Freeze
            </Button>
          )}
          {canFreeze && project.phase === "execution" && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => {
                if (confirm("Revert this project to the Concept phase?"))
                  run(() => unfreezeProject(project.id));
              }}
            >
              Reopen Concept
            </Button>
          )}
          {canFinalise && project.status === "brief_approved" && (
            <Button size="sm" disabled={pending} onClick={() => run(() => finaliseProject(project.id))}>
              Finalise project
            </Button>
          )}
          {canDelete && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => {
                if (confirm(`Delete project "${project.name}"? This cannot be undone.`))
                  run(() => deleteProject(project.id));
              }}
            >
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-md border px-4 py-2 text-sm">
          {error}
        </div>
      )}

      {project.phase === "execution" && (
        <div className="flex items-start gap-2 rounded-md border border-sky-500/40 bg-sky-500/10 px-4 py-2 text-sm text-sky-800 dark:text-sky-300">
          <Lock className="mt-0.5 size-4 shrink-0" />
          <span>
            <span className="font-medium">Design frozen.</span> This project has
            passed the Design Freeze and is in the Execution phase — the brief is
            read-only. Raise a change order for any further changes.
          </span>
        </div>
      )}

      {/* Progress tracker --------------------------------------------------- */}
      <ProgressTracker
        projectId={project.id}
        progress={progress}
        canUpdate={canUpdate}
      />

      {/* Controlled folders ------------------------------------------------- */}
      <FoldersCard projectId={project.id} folders={folders} />

      {/* Change Order Register ---------------------------------------------- */}
      <ChangeRequestsCard
        projectId={project.id}
        requests={changeRequests}
        canDecide={canDecideChanges}
      />

      {/* Questions (RFIs) --------------------------------------------------- */}
      <RfiCard projectId={project.id} rfis={rfis} departments={rfiDepartments} />

      {/* Brief(s) ------------------------------------------------------------ */}
      <Card>
        <CardHeader>
          <CardTitle>Project brief</CardTitle>
          <CardDescription>
            The first stage. Each questionnaire becomes a brief to fill in and approve.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {briefs.length === 0 ? (
            <p className="text-muted-foreground text-sm">No brief started yet.</p>
          ) : (
            <ul className="space-y-2">
              {briefs.map((b) => (
                <li
                  key={b.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2"
                >
                  <Link
                    href={`/projects/${project.id}/brief/${b.id}`}
                    className="flex items-center gap-2 text-sm font-medium hover:underline"
                  >
                    <FileText className="text-muted-foreground size-4" />
                    {b.template_label}
                    <span className="text-muted-foreground font-normal">
                      ({DISCIPLINE_LABEL[b.discipline]})
                    </span>
                  </Link>
                  <BriefStatusBadge status={b.status} />
                </li>
              ))}
            </ul>
          )}

          {canCreateBrief && available.length > 0 && (
            <div className="border-t pt-4">
              <p className="mb-2 text-sm font-medium">Add a questionnaire</p>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                {available.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="accent-primary size-4"
                      checked={picked.has(t.id)}
                      onChange={() => togglePick(t.id)}
                    />
                    {t.label}
                  </label>
                ))}
              </div>
              <Button
                size="sm"
                className="mt-3"
                disabled={pending || picked.size === 0}
                onClick={() =>
                  run(async () => {
                    const res = await createBriefs(project.id, [...picked]);
                    if (res.ok) setPicked(new Set());
                    return res;
                  })
                }
              >
                Start brief
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Members ------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>
            People on this project and their per-project role.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {members.length === 0 ? (
            <p className="text-muted-foreground text-sm">No members yet.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {members.map((m) => (
                  <tr key={m.user_id} className="border-b last:border-0">
                    <td className="py-2">{m.full_name ?? m.email ?? m.user_id}</td>
                    <td className="text-muted-foreground py-2">
                      {roleLabels[m.role_id] ?? "—"}
                    </td>
                    <td className="py-2 text-right">
                      {canManageMembers && (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => run(() => removeMember(project.id, m.user_id))}
                          className="text-muted-foreground hover:text-destructive"
                          aria-label="Remove member"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {canManageMembers && (
            <form
              className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center"
              onSubmit={(e) => {
                e.preventDefault();
                if (!memberUser || !memberRole) return;
                run(async () => {
                  const res = await addMember(project.id, memberUser, memberRole);
                  if (res.ok) {
                    setMemberUser("");
                    setMemberRole("");
                  }
                  return res;
                });
              }}
            >
              <select
                className="border-input bg-background h-9 rounded-md border px-2 sm:flex-1"
                value={memberUser}
                onChange={(e) => setMemberUser(e.target.value)}
                aria-label="Person"
              >
                <option value="">— person —</option>
                {addableUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.full_name ?? u.email}
                  </option>
                ))}
              </select>
              <select
                className="border-input bg-background h-9 rounded-md border px-2 sm:flex-1"
                value={memberRole}
                onChange={(e) => setMemberRole(e.target.value)}
                aria-label="Role"
              >
                <option value="">— role —</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
              <Button type="submit" size="sm" disabled={pending}>
                <UserPlus className="size-4" /> Add
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
