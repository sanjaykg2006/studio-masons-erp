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
import { projectsModule } from "@/modules/projects";
import { getDepartment, getDepartmentRolesConfig } from "@/modules/departments/data";
import {
  createDeptRole,
  deleteDeptRole,
  moveDeptRole,
  setDeptRolePermission,
} from "@/modules/departments/actions";
import {
  ProjectRolesEditor,
  type ProjectRoleResource,
} from "@/modules/design/components/project-roles-editor";

/** Matrix rows = the Projects module's resources (what a role can do on a project). */
const ROLE_RESOURCES: ProjectRoleResource[] = (projectsModule.resources ?? []).map((r) => ({
  id: r.id,
  label: r.label.replace(/^\w+ ·\s*/, ""),
  actions: r.actions,
}));

/** A department's roles + seniority order (generic; e.g. Project Management). */
export default async function DepartmentSettingsPage({
  params,
}: {
  params: Promise<{ deptId: string }>;
}) {
  const { deptId } = await params;
  const dept = await getDepartment(deptId);
  if (!dept || !dept.can_manage) notFound();

  const roleConfig = await getDepartmentRolesConfig(deptId);

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
          and tick what each can do.
        </p>
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
            resources={ROLE_RESOURCES}
            onCreate={createDeptRole.bind(null, deptId)}
            onDelete={deleteDeptRole.bind(null, deptId)}
            onMove={moveDeptRole.bind(null, deptId)}
            onSetPermission={setDeptRolePermission.bind(null, deptId)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
