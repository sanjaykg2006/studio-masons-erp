import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { requirePermission } from "@/core/rbac/can";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getApprovalFlows, type StepWho } from "@/modules/access/approval-data";

/** Nobody can do a step yet (full-access administrators aside). */
const nobody = (who: StepWho) =>
  who.jobTitles.length === 0 && who.projectRoles.length === 0 && who.people.length === 0;

const withPeople = (x: { label: string; people: string[] }) =>
  x.people.length ? `${x.label} (${x.people.join(", ")})` : `${x.label} (nobody holds it)`;

/**
 * Approval flows — every approval chain in the ERP, its steps in order, who can
 * do each step right now, and where that is changed. Read-only: the steps are
 * fixed by each module; who does them is the ticks, edited on the linked pages.
 */
export default async function ApprovalFlowsPage() {
  await requirePermission("access", "read");
  const flows = await getApprovalFlows();

  return (
    <div className="space-y-6">
      <Link
        href="/access"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" /> Access Control
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Approval flows</h1>
        <p className="text-muted-foreground">
          Every approval chain in the ERP, step by step: who can do each step
          right now, and where to change it. The steps themselves are fixed; who
          does them is decided by the ticks on the linked pages.
        </p>
      </div>

      {flows.map((flow) => (
        <Card key={flow.id}>
          <CardHeader>
            <CardTitle className="text-base">{flow.label}</CardTitle>
            <CardDescription>{flow.where}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ol className="space-y-3">
              {flow.steps.map((step, i) => (
                <li key={i} className="flex gap-3">
                  <span className="bg-muted text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1 space-y-1 text-sm">
                    <p className="font-medium">
                      {step.label}
                      {step.optional && (
                        <span className="bg-muted text-muted-foreground ml-2 rounded px-1.5 py-0.5 text-xs font-normal">
                          only when needed
                        </span>
                      )}
                    </p>
                    {step.tick && (
                      <p className="text-muted-foreground text-xs">Tick: {step.tick}</p>
                    )}
                    {step.rule && <p className="text-muted-foreground text-xs">{step.rule}</p>}

                    {step.who && (
                      <div className="text-xs">
                        {nobody(step.who) ? (
                          <p className="text-amber-700 dark:text-amber-400">
                            No one yet, apart from full-access administrators.
                          </p>
                        ) : (
                          <ul className="space-y-0.5">
                            {step.who.jobTitles.length > 0 && (
                              <li>
                                <span className="text-muted-foreground">Job titles: </span>
                                {step.who.jobTitles.map(withPeople).join("; ")}
                              </li>
                            )}
                            {step.who.projectRoles.length > 0 && (
                              <li>
                                <span className="text-muted-foreground">
                                  Project roles (on projects where someone holds them):{" "}
                                </span>
                                {step.who.projectRoles
                                  .map((r) => `${r.department}: ${r.role}`)
                                  .join("; ")}
                              </li>
                            )}
                            {step.who.people.length > 0 && (
                              <li>
                                <span className="text-muted-foreground">People &amp; Access: </span>
                                {step.who.people
                                  .map((p) => `${p.department}: ${p.person}`)
                                  .join("; ")}
                              </li>
                            )}
                          </ul>
                        )}
                        {step.who.fullAccess.length > 0 && (
                          <p className="text-muted-foreground mt-0.5">
                            Full access: {step.who.fullAccess.map(withPeople).join("; ")}
                          </p>
                        )}
                      </div>
                    )}

                    {step.changeAt.length > 0 && (
                      <p className="text-xs">
                        <span className="text-muted-foreground">Change it: </span>
                        {step.changeAt.map((c, j) => (
                          <span key={c.href}>
                            {j > 0 && " · "}
                            <Link href={c.href} className="underline">
                              {c.label}
                            </Link>
                          </span>
                        ))}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>

            {flow.rules && flow.rules.length > 0 && (
              <ul className="text-muted-foreground list-disc space-y-0.5 border-t pt-3 pl-5 text-xs">
                {flow.rules.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
