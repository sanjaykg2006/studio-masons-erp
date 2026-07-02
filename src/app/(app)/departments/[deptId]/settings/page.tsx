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
  getDepartmentRoleResources,
  getDepartmentRolesConfig,
} from "@/modules/departments/data";
import {
  createDeptRole,
  deleteDeptRole,
  moveDeptRole,
  setDeptRolePermission,
} from "@/modules/departments/actions";
import { ProjectRolesEditor } from "@/modules/design/components/project-roles-editor";

/** A department's roles + seniority order (generic; e.g. Project Management). */
export default async function DepartmentSettingsPage({
  params,
}: {
  params: Promise<{ deptId: string }>;
}) {
  const { deptId } = await params;
  const dept = await getDepartment(deptId);
  if (!dept || !dept.can_manage) notFound();

  // Rows are whatever modules are allotted to this department — not a fixed list.
  const [roleConfig, roleResources] = await Promise.all([
    getDepartmentRolesConfig(deptId),
    getDepartmentRoleResources(deptId),
  ]);

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
            resources={roleResources}
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
