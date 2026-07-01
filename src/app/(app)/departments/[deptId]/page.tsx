import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckSquare, Settings } from "lucide-react";

import { getDepartment } from "@/modules/departments/data";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/** A department's workspace home: task board + (for managers) roles settings. */
export default async function DepartmentHome({
  params,
}: {
  params: Promise<{ deptId: string }>;
}) {
  const { deptId } = await params;
  const dept = await getDepartment(deptId);
  if (!dept) notFound();

  return (
    <div className="space-y-6">
      <Link
        href="/departments"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" /> Departments
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{dept.label}</h1>
        <p className="text-muted-foreground">The department&apos;s internal work.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link href={`/departments/${deptId}/tasks`}>
          <Card className="hover:bg-accent/50 transition-colors">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CheckSquare className="size-4" /> Tasks
              </CardTitle>
              <CardDescription>The team to-do board and calendar.</CardDescription>
            </CardHeader>
          </Card>
        </Link>
        {dept.can_manage && (
          <Link href={`/departments/${deptId}/settings`}>
            <Card className="hover:bg-accent/50 transition-colors">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Settings className="size-4" /> Settings
                </CardTitle>
                <CardDescription>
                  This department&apos;s project roles and their seniority order.
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>
        )}
      </div>
    </div>
  );
}
