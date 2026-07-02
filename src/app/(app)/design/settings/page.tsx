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
import { designModule } from "@/modules/design";
import { projectsModule } from "@/modules/projects";
import {
  getFolderAccessConfig,
  getProjectRolesConfig,
  getStageSteps,
  getSubteamsConfig,
} from "@/modules/design/data";
import {
  createProjectRole,
  deleteProjectRole,
  moveProjectRole,
  setProjectRolePermission,
} from "@/modules/design/actions";
import { FolderAccessMatrix } from "@/modules/design/components/folder-access-matrix";
import {
  ProjectRolesEditor,
  type ProjectRoleResource,
} from "@/modules/design/components/project-roles-editor";
import { StageStepsEditor } from "@/modules/design/components/stage-steps-editor";
import { SubteamsEditor } from "@/modules/design/components/subteams-editor";

/**
 * The matrix rows for a Design project role: what it can do on a project (the
 * Projects module's resources) plus Design's own controlled-folder settings.
 * Driven by the registry, so new sub-resources show up here automatically. The
 * leading "Word · " label prefix is dropped for a cleaner column.
 */
const PROJECT_ROLE_RESOURCES: ProjectRoleResource[] = [
  ...(projectsModule.resources ?? []),
  ...(designModule.resources ?? []).filter((r) => r.id === "design.folder"),
].map((r) => ({
  id: r.id,
  label: r.label.replace(/^\w+ ·\s*/, ""),
  actions: r.actions,
}));

/** Design configuration: project roles + folder access + the stage checklist. */
export default async function DesignSettingsPage() {
  await requirePermission("design.folder", "manage");

  const [roleConfig, config, steps, subteams] = await Promise.all([
    getProjectRolesConfig(),
    getFolderAccessConfig(),
    getStageSteps(),
    getSubteamsConfig(),
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
            resources={PROJECT_ROLE_RESOURCES}
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
