import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { AppUser } from "@/core/auth/types";

/**
 * Presentational view for the dashboard module. Receives the current user
 * from the page (Server Component) — keeps data-loading out of the view.
 */
export function DashboardView({ user }: { user: AppUser }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Welcome back{user.email ? `, ${user.email}` : ""}.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Modules</CardTitle>
            <CardDescription>Active feature modules</CardDescription>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">1</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
            <CardDescription>Foundation</CardDescription>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">Ready</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Next step</CardTitle>
            <CardDescription>Add a feature module</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Drop a folder in <code>src/modules</code> and register it.
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
