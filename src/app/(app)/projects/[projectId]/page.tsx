import { notFound } from "next/navigation";

import { requireProjectPermission, canOnProject } from "@/core/rbac/can";
import { projectLinkModules } from "@/core/modules/registry";
import {
  getProjectDetail,
  getMembershipPickers,
  getProjectChangeRequests,
  getProjectFolders,
  getProjectProgress,
  getPublishableTemplates,
} from "@/modules/design/data";
import { getProjectRfis } from "@/modules/design/rfi-data";
import { ProjectDetail } from "@/modules/design/components/project-detail";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  await requireProjectPermission(projectId, "project", "read");

  const detail = await getProjectDetail(projectId);
  if (!detail) notFound();

  const canManageMembers = detail.can("project.member", "manage");
  const canCreateBrief = detail.can("project.brief", "create");

  // Which per-project module pages this user may open — computed from the registry,
  // so a module surfaces its link just by declaring `projectLink` (no list here).
  const linkResourceIds = projectLinkModules().flatMap((g) => g.resources.map((r) => r.id));

  const [pickers, templates, progress, folders, changeRequests, rfis, ...linkPerms] =
    await Promise.all([
      canManageMembers ? getMembershipPickers() : Promise.resolve({ users: [], roles: [] }),
      canCreateBrief ? getPublishableTemplates() : Promise.resolve([]),
      getProjectProgress(projectId),
      getProjectFolders(projectId),
      getProjectChangeRequests(projectId),
      getProjectRfis(projectId),
      ...linkResourceIds.map((id) => canOnProject(projectId, id, "read")),
    ]);

  const visibleModuleResourceIds = linkResourceIds.filter((_, i) => linkPerms[i]);

  return (
    <ProjectDetail
      project={detail.project}
      progress={progress}
      folders={folders}
      changeRequests={changeRequests}
      rfis={rfis.rfis}
      rfiDepartments={rfis.departments}
      rfiRolesByDept={rfis.rolesByDept}
      visibleModuleResourceIds={visibleModuleResourceIds}
      canDecideChanges={detail.can("project", "approve")}
      members={detail.members}
      briefs={detail.briefs}
      roleLabels={Object.fromEntries(pickers.roles.map((r) => [r.id, r.label]))}
      users={pickers.users}
      roles={pickers.roles}
      templates={templates}
      canUpdate={detail.can("project", "update")}
      canDelete={detail.can("project", "delete")}
      canFinalise={detail.can("project", "approve")}
      canFreeze={detail.can("project", "approve")}
      canManageMembers={canManageMembers}
      canCreateBrief={canCreateBrief}
    />
  );
}
