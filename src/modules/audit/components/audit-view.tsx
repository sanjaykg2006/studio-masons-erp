import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { actionLabel, actorLabel } from "@/modules/audit/format";
import type { AuditEntry } from "@/modules/audit/data";

/**
 * Presentational, read-only view of the audit trail. Server-rendered — receives
 * already-loaded entries from the page and just formats them.
 */
export function AuditView({ entries }: { entries: AuditEntry[] }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Activity Log</h1>
        <p className="text-muted-foreground">
          A record of sensitive changes — who did what, and when.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>
            {entries.length === 0
              ? "Nothing recorded yet."
              : `Showing the latest ${entries.length} events, newest first.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No activity has been recorded yet. Actions like inviting a user or
              changing a role will appear here.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left">
                  <th className="py-2 font-medium">When</th>
                  <th className="py-2 font-medium">Who</th>
                  <th className="py-2 font-medium">Action</th>
                  <th className="py-2 font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-b last:border-0 align-top">
                    <td className="text-muted-foreground py-2 whitespace-nowrap">
                      {new Date(e.created_at).toLocaleString("en-GB")}
                    </td>
                    <td className="py-2">{actorLabel(e.actor_email)}</td>
                    <td className="py-2">
                      <span className="bg-accent text-accent-foreground rounded px-2 py-0.5 text-xs">
                        {actionLabel(e.action)}
                      </span>
                    </td>
                    <td className="py-2">{e.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
