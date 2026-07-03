import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckSquare, Settings, ShoppingCart, Users } from "lucide-react";

import { can } from "@/core/rbac/can";
import { getMyDepartments } from "@/modules/departments/data";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Procurement Department home — a hub of the department's internal work, mirroring
 * the Design hub. Tasks / People / Settings reuse the generic department routes;
 * the vendor directory is Procurement's own library. Per-project procurement work
 * (budget, intents, orders) is reached from each project.
 */
export default async function ProcurementPage() {
  const [canVendors, myDepts] = await Promise.all([
    can("procurement.vendor", "read"),
    getMyDepartments(),
  ]);
  const dept = myDepts.find((d) => d.key === "procurement");
  if (!dept && !canVendors) {
    redirect("/forbidden?resource=procurement.vendor&action=read");
  }
  const canManage = dept?.can_manage ?? false;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Procurement</h1>
        <p className="text-muted-foreground">The department&apos;s internal work.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
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
                <CardDescription>
                  Add teammates and set each person&apos;s role and abilities.
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>
        )}
        {canVendors && (
          <Link href="/procurement/vendors">
            <Card className="hover:bg-accent/50 transition-colors">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShoppingCart className="size-4" /> Vendor directory
                </CardTitle>
                <CardDescription>
                  The company&apos;s suppliers, subcontractors and service providers.
                </CardDescription>
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
