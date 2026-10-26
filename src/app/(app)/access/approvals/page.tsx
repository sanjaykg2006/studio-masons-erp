import Link from "next/link";
import { ArrowLeft, Hourglass } from "lucide-react";

import { can, requirePermission } from "@/core/rbac/can";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getApprovalFlows,
  listWaitingApprovals,
  type StepWho,
} from "@/modules/access/approval-data";
import { ApprovalStagesEditor } from "@/modules/access/components/approval-stages-editor";

/** Nobody can do a step yet (full-access administrators aside). */
const nobody = (who: StepWho) =>
  who.jobTitles.length === 0 &&
  who.projectRoles.length === 0 &&
  who.people.length === 0 &&
  who.allProjects.length === 0 &&
  who.leads.length === 0;

const withPeople = (x: { label: string; people: string[] }) =>
  x.people.length ? `${x.label} (${x.people.join(", ")})` : `${x.label} (nobody holds it)`;

/**
 * Approval flows — every approval chain in the ERP, its steps in order, who can
 * do each step right now, and where that is changed. Flows on the approval
 * engine (0089) also get an editor for their approval stages; the fixed work
 * steps and the other flows are described, not edited.
 */
export default async function ApprovalFlowsPage() {
  await requirePermission("access", "read");
  const [{ flows, jobTitles, roles }, canEdit, waiting] = await Promise.all([
    getApprovalFlows(),
    can("access", "update"),
    listWaitingApprovals(),
  ]);
  const stuck = waiting.filter((w) => w.stuck).length;
  // Stages pointing at a role nobody active holds: items reaching them stop.
  const dead = flows.flatMap((f) =>
    f.steps.filter((s) => s.nobodyHolds).map((s) => `${f.label}: ${s.label}`)
  );
  // Stages nobody but an administrator can give, because no role is chosen.
  const unset = flows.flatMap((f) =>
    f.steps.filter((s) => s.needsRole).map((s) => `${f.label}: ${s.label}`)
  );

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
          right now, and where to change it. Every approval stage is given by
          one named role and nobody else; a different person has to give each
          stage of the same item.
        </p>
      </div>

      <Link
        href="/access/approvals/waiting"
        className={
          stuck > 0
            ? "flex items-center gap-2 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
            : "hover:bg-accent/50 flex items-center gap-2 rounded-md border px-4 py-3 text-sm"
        }
      >
        <Hourglass className="size-4 shrink-0" />
        <span>
          <span className="font-medium">
            {waiting.length === 0
              ? "Nothing is waiting for approval"
              : `${waiting.length} item${waiting.length === 1 ? "" : "s"} waiting for approval`}
          </span>
          {stuck > 0 && ` — ${stuck} stuck or waiting too long`}
          {waiting.length > 0 && " · See who each one is waiting on →"}
        </span>
      </Link>

      {dead.length > 0 && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          <p className="font-medium">Nobody holds the approving role for these stages</p>
          <p className="mt-1 text-xs">
            Anything that reaches them will get stuck until someone is given the
            role (or a full-access administrator overrides it). Give the role to
            a person, or pick a different role for the stage.
          </p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs">
            {dead.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </div>
      )}

      {unset.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <p className="font-medium">These stages still need a role</p>
          <p className="mt-1 text-xs">
            Until one is chosen, only a full-access administrator can give them,
            and every such approval is recorded as an override.
          </p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs">
            {unset.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </div>
      )}

      {flows.map((flow) => (
        <Card key={flow.id}>
          <CardHeader>
            <CardTitle className="text-base">
              {flow.label}
              {flow.engine && (
                <span className="bg-primary/10 text-primary ml-2 rounded px-1.5 py-0.5 text-xs font-normal">
                  editable stages
                </span>
              )}
            </CardTitle>
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
                    {step.nobodyHolds && (
                      <p className="text-xs font-medium text-red-700 dark:text-red-400">
                        Nobody holds this role yet — items reaching this stage will get stuck.
                      </p>
                    )}

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
                            {step.who.allProjects.length > 0 && (
                              <li>
                                <span className="text-muted-foreground">
                                  Holds it on every project:{" "}
                                </span>
                                {step.who.allProjects
                                  .map((p) => `${p.person} (${p.department})`)
                                  .join("; ")}
                              </li>
                            )}
                            {step.who.leads.length > 0 && (
                              <li>
                                <span className="text-muted-foreground">Department leads: </span>
                                {step.who.leads
                                  .map((p) => `${p.department}: ${p.person}`)
                                  .join("; ")}
                              </li>
                            )}
                          </ul>
                        )}
                        {step.who.fullAccess.length > 0 && (
                          <p className="text-muted-foreground mt-0.5">
                            Administrator backup (recorded as an override):{" "}
                            {step.who.fullAccess.map(withPeople).join("; ")}
                          </p>
                        )}
                      </div>
                    )}

                    {step.changeAt.length > 0 && (
                      <p className="text-xs">
                        <span className="text-muted-foreground">Change it: </span>
                        {step.changeAt.map((c, j) => (
                          <span key={`${c.href}-${j}`}>
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

            {flow.engine && canEdit && (
              <ApprovalStagesEditor
                flow={flow.engine}
                jobTitles={jobTitles}
                roles={roles}
              />
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
