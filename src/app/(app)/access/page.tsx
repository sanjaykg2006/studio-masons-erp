import { requirePermission } from "@/core/rbac/can";
import { requireUser } from "@/core/auth/get-user";
import { moduleResources } from "@/core/modules/registry";
import { getAccessData } from "@/modules/access/data";
import {
  AccessView,
  type AccessResource,
} from "@/modules/access/components/access-view";

/** Resources shown on Access Control: every gated resource, in order, except the
 * abilities built into every department (tasks, settings, people) — those live
 * on each department's People & Access page. Mapped to the plain
 * {id,label,actions} shape — the registry rows also carry a projectLink icon (a
 * component), which can't cross into the client AccessView. */
const resources: AccessResource[] = moduleResources()
  .filter((r) => !r.everyDepartment)
  .map((r) => ({
    id: r.id,
    label: r.label,
    actions: r.actions,
  }));

export default async function AccessPage() {
  await requirePermission("access", "read");
  const user = await requireUser();
  const {
    roles,
    permissions,
    users,
    departments,
    departmentModules,
    departmentLeads,
    generalModules,
  } = await getAccessData();

  return (
    <AccessView
      roles={roles}
      permissions={permissions}
      users={users}
      resources={resources}
      departments={departments}
      departmentModules={departmentModules}
      departmentLeads={departmentLeads}
      generalModules={generalModules}
      currentUserId={user.id}
    />
  );
}
