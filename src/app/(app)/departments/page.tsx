import Link from "next/link";
import { ArrowLeft, Building2 } from "lucide-react";

import { getMyDepartments } from "@/modules/departments/data";
import { DEPARTMENT_HOME } from "@/modules/departments/home";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/** Hub listing the departments the user belongs to, each linking to its
 * workspace (task board + roles settings). Design and Procurement keep their
 * own richer pages; the rest use the generic department workspace. */
export default async function DepartmentsPage() {
  const depts = await getMyDepartments();

  return (
    <div className="space-y-6">
      <Link
        href="/dashboard"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" /> Dashboard
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Departments</h1>
        <p className="text-muted-foreground">
          The departments you work in. Open one for its task board and settings.
        </p>
      </div>

      {depts.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          You&apos;re not on any department team yet.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {depts.map((d) => (
            <Link key={d.id} href={DEPARTMENT_HOME[d.key] ?? `/departments/${d.id}`}>
              <Card className="hover:bg-accent/50 h-full transition-colors">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Building2 className="size-4" /> {d.label}
                  </CardTitle>
                  <CardDescription>
                    {d.is_lead ? "You lead this department." : "You're on this team."}
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
