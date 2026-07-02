import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckSquare, FileText, Settings, Users } from "lucide-react";

import { can } from "@/core/rbac/can";
import { hasDesignAccess, hasDesignTeamAccess } from "@/core/rbac/permissions";
import { getMyDepartments } from "@/modules/departments/data";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Design Department home — the department's internal work. Projects moved to the
 * company-wide Projects module (Step 2); what stays here is the questionnaire
 * template library and the folder/stage/role settings.
 */
export default async function DesignPage() {
  const [canTemplates, canSettings, canTasks, myDepts] = await Promise.all([
    can("design.template", "read"),
    can("design.folder", "manage"),
    hasDesignTeamAccess(),
    getMyDepartments(),
  ]);
  if (!canTemplates && !canSettings && !canTasks && !(await hasDesignAccess())) {
    redirect("/forbidden?resource=design.template&action=read");
  }

  const designDept = myDepts.find((d) => d.key === "design");
  const canPeople = designDept?.can_manage ?? false;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Design Department
        </h1>
        <p className="text-muted-foreground">
          The department&apos;s internal work. Projects live under{" "}
          <Link href="/projects" className="underline">
            Projects
          </Link>
          .
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {canTasks && (
          <Link href="/design/tasks">
            <Card className="hover:bg-accent/50 transition-colors">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <CheckSquare className="size-4" /> Tasks
                </CardTitle>
                <CardDescription>
                  The team to-do board and calendar. Concept and Technical tasks
                  stay private to their own team.
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>
        )}
        {canPeople && designDept && (
          <Link href={`/departments/${designDept.id}/people`}>
            <Card className="hover:bg-accent/50 transition-colors">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Users className="size-4" /> People &amp; Access
                </CardTitle>
                <CardDescription>
                  Add teammates and set each person&apos;s role, sub-team and
                  abilities.
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>
        )}
        {canTemplates && (
          <Link href="/design/templates">
            <Card className="hover:bg-accent/50 transition-colors">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileText className="size-4" /> Template library
                </CardTitle>
                <CardDescription>
                  Versioned questionnaire templates used to build project briefs.
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>
        )}
        {canSettings && (
          <Link href="/design/settings">
            <Card className="hover:bg-accent/50 transition-colors">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Settings className="size-4" /> Settings
                </CardTitle>
                <CardDescription>
                  Project roles, controlled-folder access and the stage checklist.
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>
        )}
      </div>
    </div>
  );
}
