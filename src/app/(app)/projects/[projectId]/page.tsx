import { notFound } from "next/navigation";

import { requireProjectPermission, canOnProject } from "@/core/rbac/can";
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

  const [
    pickers,
    templates,
    progress,
    folders,
    changeRequests,
    rfis,
    canViewBudget,
    canViewIntents,
  ] = await Promise.all([
    canManageMembers ? getMembershipPickers() : Promise.resolve({ users: [], roles: [] }),
    canCreateBrief ? getPublishableTemplates() : Promise.resolve([]),
    getProjectProgress(projectId),
    getProjectFolders(projectId),
    getProjectChangeRequests(projectId),
    getProjectRfis(projectId),
    canOnProject(projectId, "procurement.budget", "read"),
    canOnProject(projectId, "procurement.intent", "read"),
  ]);

  return (
    <ProjectDetail
      project={detail.project}
      progress={progress}
      folders={folders}
      changeRequests={changeRequests}
      rfis={rfis.rfis}
      rfiDepartments={rfis.departments}
      rfiRolesByDept={rfis.rolesByDept}
      canViewBudget={canViewBudget}
      canViewIntents={canViewIntents}
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
