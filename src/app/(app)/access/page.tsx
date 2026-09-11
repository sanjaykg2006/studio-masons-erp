import { requirePermission } from "@/core/rbac/can";
import { requireUser } from "@/core/auth/get-user";
import { effectiveHome, moduleResources } from "@/core/modules/registry";
import { getStoredHomes } from "@/core/modules/homes";
import { getAccessData } from "@/modules/access/data";
import {
  AccessView,
  type AccessResource,
} from "@/modules/access/components/access-view";

export default async function AccessPage() {
  await requirePermission("access", "read");
  const user = await requireUser();
  const [
    {
      roles,
      permissions,
      users,
      departments,
      departmentModules,
      departmentLeads,
      generalModules,
    },
    homes,
  ] = await Promise.all([getAccessData(), getStoredHomes()]);

  // Every gated resource, in order, except the abilities built into every
  // department (they live on People & Access). Plain {id,label,…} — the
  // registry rows also carry a projectLink icon (a component), which can't
  // cross into the client AccessView.
  const resources: AccessResource[] = moduleResources()
    .filter((r) => !r.everyDepartment)
    .map((r) => ({
      id: r.id,
      label: r.label,
      actions: r.actions,
      home: effectiveHome(r, homes.get(r.id)),
      homes: r.homes,
      whyNot: r.whyNot,
    }));

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
