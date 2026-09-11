import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowLeft,
  Bug,
  CheckSquare,
  History,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";

import { can } from "@/core/rbac/can";
import { getMyDepartments } from "@/modules/departments/data";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * IT Department home — the company's access control and system logs, plus the
 * department's own Tasks / People / Settings (the generic department routes).
 * Each card shows only to someone allowed to open it; the pages themselves
 * keep their own guards.
 */
export default async function ITPage() {
  const [canAccess, canAudit, canErrors, myDepts] = await Promise.all([
    can("access", "read"),
    can("audit", "read"),
    can("errorlog", "read"),
    getMyDepartments(),
  ]);
  const dept = myDepts.find((d) => d.key === "it");
  if (!dept && !canAccess && !canAudit && !canErrors) {
    redirect("/forbidden?resource=access&action=read");
  }

  return (
    <div className="space-y-6">
      <Link
        href="/departments"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" /> Departments
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">IT</h1>
        <p className="text-muted-foreground">
          Who can open what across the company, and what has happened in it.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {canAccess && (
          <Link href="/access">
            <Card className="hover:bg-accent/50 transition-colors">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShieldCheck className="size-4" /> Access Control
                </CardTitle>
                <CardDescription>
                  Job titles, departments, leads and people — who can open what.
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>
        )}
        {canAudit && (
          <Link href="/audit">
            <Card className="hover:bg-accent/50 transition-colors">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <History className="size-4" /> Activity Log
                </CardTitle>
                <CardDescription>
                  Who did what, and when, across the company.
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>
        )}
        {canErrors && (
          <Link href="/logs">
            <Card className="hover:bg-accent/50 transition-colors">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Bug className="size-4" /> Error Log
                </CardTitle>
                <CardDescription>
                  Website crashes and server errors, for fixing.
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>
        )}
        {dept && (
          <Link href={`/departments/${dept.id}/tasks`}>
            <Card className="hover:bg-accent/50 transition-colors">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <CheckSquare className="size-4" /> Tasks
                </CardTitle>
                <CardDescription>The team to-do board and calendar.</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        )}
        {dept?.can_manage_people && (
          <Link href={`/departments/${dept.id}/people`}>
            <Card className="hover:bg-accent/50 transition-colors">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Users className="size-4" /> People &amp; Access
                </CardTitle>
                <CardDescription>
                  Add teammates and give them the Activity Log or Error Log.
                  Access Control is handed out by an Administrator.
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>
        )}
        {dept?.can_manage_settings && (
          <Link href={`/departments/${dept.id}/settings`}>
            <Card className="hover:bg-accent/50 transition-colors">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Settings className="size-4" /> Settings
                </CardTitle>
                <CardDescription>
                  The list of roles this department offers and what each can do.
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>
        )}
      </div>
    </div>
  );
}
