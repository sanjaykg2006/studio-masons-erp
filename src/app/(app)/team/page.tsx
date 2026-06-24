import { redirect } from "next/navigation";

import { requireUser } from "@/core/auth/get-user";
import { myLeadDepartmentIds } from "@/core/rbac/permissions";
import { moduleResources } from "@/core/modules/registry";
import { getTeamAccessData } from "@/modules/team-access/data";
import { TeamAccessView } from "@/modules/team-access/components/team-access-view";
import type { AccessResource } from "@/modules/access/components/permission-matrix";

/** Matrix columns come from the registry, like the central page. */
const resources: AccessResource[] = moduleResources();

/** A department lead's self-service page — scoped to the department(s) they lead. */
export default async function TeamAccessPage() {
  await requireUser();
  const deptIds = await myLeadDepartmentIds();
  if (deptIds.length === 0) {
    redirect("/forbidden?resource=team.access&action=read");
  }

  const {
    departments,
    roles,
    permissions,
    departmentModules,
    members,
    generalModules,
  } = await getTeamAccessData(deptIds);

  return (
    <TeamAccessView
      departments={departments}
      roles={roles}
      permissions={permissions}
      departmentModules={departmentModules}
      members={members}
      resources={resources}
      generalModules={generalModules}
    />
  );
}
