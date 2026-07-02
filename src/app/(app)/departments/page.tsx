import Link from "next/link";
import { Building2 } from "lucide-react";

import { getMyDepartments } from "@/modules/departments/data";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/** Departments with their own richer home page (not the generic workspace). */
const DEPT_HOME: Record<string, string> = {
  design: "/design",
  procurement: "/procurement",
};

/** Hub listing the departments the user belongs to, each linking to its
 * workspace (task board + roles settings). Design and Procurement keep their
 * own richer pages; the rest use the generic department workspace. */
export default async function DepartmentsPage() {
  const depts = await getMyDepartments();

  return (
    <div className="space-y-6">
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
            <Link key={d.id} href={DEPT_HOME[d.key] ?? `/departments/${d.id}`}>
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
