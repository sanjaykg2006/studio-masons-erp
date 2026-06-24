import { requirePermission } from "@/core/rbac/can";
import { requireUser } from "@/core/auth/get-user";
import { moduleResources } from "@/core/modules/registry";
import { getAccessData } from "@/modules/access/data";
import {
  AccessView,
  type AccessResource,
} from "@/modules/access/components/access-view";

/** Resources shown in the permission matrix: every gated resource, in order. */
const resources: AccessResource[] = moduleResources();

export default async function AccessPage() {
  await requirePermission("access", "read");
  const user = await requireUser();
  const {
    roles,
    permissions,
    users,
    departments,
    departmentModules,
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
      generalModules={generalModules}
      currentUserId={user.id}
    />
  );
}
