import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getFolderAccessConfig } from "@/modules/design/data";
import { setFolderAccess } from "@/modules/design/actions";
import {
  getDepartment,
  getDepartmentIdByKey,
  getDepartmentRoleResources,
  getDepartmentRolesConfig,
  getDepartmentToolLabels,
} from "@/modules/departments/data";
import {
  createDeptRole,
  deleteDeptRole,
  moveDeptRole,
  setDeptRolePermission,
} from "@/modules/departments/actions";
import { FolderAccessMatrix } from "@/modules/design/components/folder-access-matrix";
import { ProjectRolesEditor } from "@/modules/design/components/project-roles-editor";

/** Design configuration: project roles + folder access. */
export default async function DesignSettingsPage() {
  // The same gate and the same role code as every other department's Settings:
  // a lead of Design, HR, or someone given Design's "Settings" ability.
  const designId = await getDepartmentIdByKey("design");
  const dept = designId ? await getDepartment(designId) : null;
  if (!designId || !dept?.can_manage_settings) {
    redirect("/forbidden?resource=department.settings&action=manage");
  }

  const [roleConfig, roleResources, folderConfig, toolLabels] = await Promise.all([
    getDepartmentRolesConfig(designId),
    getDepartmentRoleResources(designId),
    getFolderAccessConfig(),
    getDepartmentToolLabels(designId),
  ]);

  return (
    <div className="space-y-6">
      <Link
        href="/design"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" /> Design Department
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Design settings — how Design works on projects
        </h1>
        <p className="text-muted-foreground text-sm">
          The roles Design gives people on a project and what each can do there.
          The projects themselves live under{" "}
          <Link href="/projects" className="underline">
            Projects
          </Link>
          . Who is on the team, their Concept or Technical sub-team, and what they
          can do inside Design is set in{" "}
          {dept.can_manage_people ? (
            <Link href={`/departments/${designId}/people`} className="underline">
              People &amp; Access
            </Link>
          ) : (
            "People & Access"
          )}
          .
        </p>
        {toolLabels.length > 0 && (
          <p className="text-muted-foreground mt-1 text-sm">
            Also given to Design, and set per person on People &amp; Access:{" "}
            {toolLabels.join(", ")}.
          </p>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Design&apos;s project roles</CardTitle>
          <CardDescription>
            The roles Design gives people on a project (Designer, Junior, …) and
            what each can do. New roles appear in every Design project&apos;s
            &ldquo;add member&rdquo; list straight away.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProjectRolesEditor
            roles={roleConfig.roles}
            permissions={roleConfig.permissions}
            resources={roleResources}
            onCreate={createDeptRole.bind(null, designId)}
            onDelete={deleteDeptRole.bind(null, designId)}
            onMove={moveDeptRole.bind(null, designId)}
            onSetPermission={setDeptRolePermission.bind(null, designId)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Controlled folder access</CardTitle>
          <CardDescription>
            Who can do what in each of the 12 standard project folders, by Design
            role. Applies to Design&apos;s projects.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FolderAccessMatrix
            folders={folderConfig.folders}
            roles={folderConfig.roles}
            access={folderConfig.access}
            onSet={setFolderAccess}
          />
        </CardContent>
      </Card>
    </div>
  );
}
