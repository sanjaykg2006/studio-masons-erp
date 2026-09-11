import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getDepartment,
  getDepartmentFolderAccess,
  getDepartmentModuleIds,
  getDepartmentRoleResources,
  getDepartmentRolesConfig,
  getDepartmentToolLabels,
} from "@/modules/departments/data";
import {
  createDeptRole,
  deleteDeptRole,
  moveDeptRole,
  setDeptFolderAccess,
  setDeptRolePermission,
} from "@/modules/departments/actions";
import { FolderAccessMatrix } from "@/modules/design/components/folder-access-matrix";
import { ProjectRolesEditor } from "@/modules/design/components/project-roles-editor";

/** A department's roles + seniority order (generic; e.g. Project Management). */
export default async function DepartmentSettingsPage({
  params,
}: {
  params: Promise<{ deptId: string }>;
}) {
  const { deptId } = await params;
  const dept = await getDepartment(deptId);
  if (!dept || !dept.can_manage_settings) notFound();

  // Rows are whatever modules are allotted to this department — not a fixed list.
  const [roleConfig, roleResources, moduleIds, toolLabels] = await Promise.all([
    getDepartmentRolesConfig(deptId),
    getDepartmentRoleResources(deptId),
    getDepartmentModuleIds(deptId),
    getDepartmentToolLabels(deptId),
  ]);

  // The controlled-folder access grid only appears once the department has been
  // given the Controlled Folder Access module on the Access Control page.
  const folderConfig = moduleIds.has("folder.access")
    ? await getDepartmentFolderAccess(deptId)
    : null;

  return (
    <div className="space-y-6">
      <Link
        href={`/departments/${deptId}`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" /> {dept.label}
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{dept.label} settings</h1>
        <p className="text-muted-foreground text-sm">
          Create the roles people are given on a project, order them by seniority,
          and tick what each can do on a project. Who is on the team and what they
          can do inside the department is set in People &amp; Access.
        </p>
        {toolLabels.length > 0 && (
          <p className="text-muted-foreground mt-1 text-sm">
            Also given to {dept.label}, and set per person on People &amp; Access:{" "}
            {toolLabels.join(", ")}.
          </p>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Project roles</CardTitle>
          <CardDescription>
            New roles appear in every project&apos;s &ldquo;add member&rdquo; list.
            Order (top = most senior) sets who a question escalates to.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProjectRolesEditor
            roles={roleConfig.roles}
            permissions={roleConfig.permissions}
            resources={roleResources}
            onCreate={createDeptRole.bind(null, deptId)}
            onDelete={deleteDeptRole.bind(null, deptId)}
            onMove={moveDeptRole.bind(null, deptId)}
            onSetPermission={setDeptRolePermission.bind(null, deptId)}
          />
        </CardContent>
      </Card>

      {folderConfig && (
        <Card>
          <CardHeader>
            <CardTitle>Controlled folder access</CardTitle>
            <CardDescription>
              Who can do what in each of the standard project folders, by{" "}
              {dept.label} role. Applies to this department&apos;s work on every
              project.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FolderAccessMatrix
              folders={folderConfig.folders}
              roles={folderConfig.roles}
              access={folderConfig.access}
              onSet={setDeptFolderAccess.bind(null, deptId)}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
