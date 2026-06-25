import { redirect } from "next/navigation";

import { requireUser } from "@/core/auth/get-user";
import { myLeadDepartmentIds } from "@/core/rbac/permissions";
import { moduleResources } from "@/core/modules/registry";
import { getTeamAccessData } from "@/modules/team-access/data";
import { TeamAccessView } from "@/modules/team-access/components/team-access-view";
import type { AccessResource } from "@/modules/access/components/permission-matrix";

/**
 * Team Access only manages DEPARTMENT-LEVEL capabilities (manage the template
 * library, create projects, edit settings). Project + file access comes from
 * project roles instead, so project-level resources are excluded here.
 */
const resources: AccessResource[] = moduleResources().filter(
  (r) => r.departmentLevel
);

/** A department lead's self-service page — scoped to the department(s) they lead. */
export default async function TeamAccessPage() {
  await requireUser();
  const deptIds = await myLeadDepartmentIds();
  if (deptIds.length === 0) {
    redirect("/forbidden?resource=team.access&action=read");
  }

  const {
    departments,
    departmentModules,
    members,
    grants,
    people,
    roles,
    generalModules,
  } = await getTeamAccessData(deptIds);

  return (
    <TeamAccessView
      departments={departments}
      departmentModules={departmentModules}
      members={members}
      grants={grants}
      people={people}
      roles={roles}
      resources={resources}
      generalModules={generalModules}
    />
  );
}
