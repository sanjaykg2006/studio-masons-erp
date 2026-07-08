import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, BarChart3, Building2, CheckSquare, Settings, Users } from "lucide-react";

import { can } from "@/core/rbac/can";
import { getMyDepartments } from "@/modules/departments/data";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Finance Department home — a hub of the money desk. Reports show all projects;
 * per-project invoices/payments/advances are reached from each project. Tasks /
 * People / Settings reuse the generic department routes.
 */
export default async function FinancePage() {
  const [canReports, canSettings, myDepts] = await Promise.all([
    can("finance.invoice", "read"),
    can("finance.settings", "read"),
    getMyDepartments(),
  ]);
  const dept = myDepts.find((d) => d.key === "finance");
  if (!dept && !canReports) {
    redirect("/forbidden?resource=finance.invoice&action=read");
  }
  const canManage = dept?.can_manage ?? false;

  return (
    <div className="space-y-6">
      <Link
        href="/departments"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" /> Departments
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
        <p className="text-muted-foreground">The money desk — invoices, payments, advances and retention.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {canReports && (
          <Link href="/finance/reports">
            <Card className="hover:bg-accent/50 transition-colors">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <BarChart3 className="size-4" /> Reports
                </CardTitle>
                <CardDescription>
                  Money owed, paid this month, advances unpaid and retention held — across every project.
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>
        )}
        {canSettings && (
          <Link href="/finance/settings">
            <Card className="hover:bg-accent/50 transition-colors">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Building2 className="size-4" /> Billing branches
                </CardTitle>
                <CardDescription>The company&apos;s GST registrations, chosen on each purchase order.</CardDescription>
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
        {canManage && dept && (
          <Link href={`/departments/${dept.id}/people`}>
            <Card className="hover:bg-accent/50 transition-colors">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Users className="size-4" /> People &amp; Access
                </CardTitle>
                <CardDescription>Add teammates and set each person&apos;s role and abilities.</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        )}
        {canManage && dept && (
          <Link href={`/departments/${dept.id}/settings`}>
            <Card className="hover:bg-accent/50 transition-colors">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Settings className="size-4" /> Settings
                </CardTitle>
                <CardDescription>The list of roles this department offers and what each can do.</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        )}
      </div>
    </div>
  );
}
