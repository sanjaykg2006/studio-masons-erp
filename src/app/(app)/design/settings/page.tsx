import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { requirePermission } from "@/core/rbac/can";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getFolderAccessConfig,
  getProjectRolesConfig,
  getStageSteps,
  getSubteamsConfig,
} from "@/modules/design/data";
import {
  getDepartmentIdByKey,
  getDepartmentRoleResources,
  type MatrixResource,
} from "@/modules/departments/data";
import {
  createProjectRole,
  deleteProjectRole,
  moveProjectRole,
  setProjectRolePermission,
} from "@/modules/design/actions";
import { FolderAccessMatrix } from "@/modules/design/components/folder-access-matrix";
import { ProjectRolesEditor } from "@/modules/design/components/project-roles-editor";
import { StageStepsEditor } from "@/modules/design/components/stage-steps-editor";
import { SubteamsEditor } from "@/modules/design/components/subteams-editor";

/** Design configuration: project roles + folder access + the stage checklist. */
export default async function DesignSettingsPage() {
  await requirePermission("design.folder", "manage");

  // The role-matrix rows are whatever modules are allotted to Design — driven by
  // department_modules, so allotting a new module surfaces it here automatically.
  const designId = await getDepartmentIdByKey("design");
  const [roleConfig, config, steps, subteams, roleResources] = await Promise.all([
    getProjectRolesConfig(),
    getFolderAccessConfig(),
    getStageSteps(),
    getSubteamsConfig(),
    designId
      ? getDepartmentRoleResources(designId)
      : Promise.resolve([] as MatrixResource[]),
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
          Design settings — how Design runs its projects
        </h1>
        <p className="text-muted-foreground text-sm">
          This is the Design department&apos;s own rulebook. The projects
          themselves live under{" "}
          <Link href="/projects" className="underline">
            Projects
          </Link>
          ; the rules below decide how Design works on them and apply to every
          Design project immediately.
        </p>
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
            onCreate={createProjectRole}
            onDelete={deleteProjectRole}
            onMove={moveProjectRole}
            onSetPermission={setProjectRolePermission}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Design&apos;s controlled folder access</CardTitle>
          <CardDescription>
            Who can do what in each of the 12 standard project folders, by Design
            role. Applies to Design&apos;s projects.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FolderAccessMatrix
            folders={config.folders}
            roles={config.roles}
            access={config.access}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Concept &amp; Technical teams</CardTitle>
          <CardDescription>
            Split the Design team into Concept (early design, up to the Design
            Freeze) and Technical (detailed work after it). This sets who belongs
            where; keeping each team&apos;s tasks private from the other comes
            with the task board.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SubteamsEditor
            subteams={subteams.subteams}
            members={subteams.members}
            membership={subteams.membership}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Design&apos;s stage checklist</CardTitle>
          <CardDescription>
            The steps that fill each Design project&apos;s progress bars. Add,
            rename or remove steps per stage.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StageStepsEditor steps={steps} />
        </CardContent>
      </Card>
    </div>
  );
}
