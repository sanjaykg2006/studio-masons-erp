"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { cn } from "@/lib/utils";
import { setSubteamMember } from "@/modules/design/actions";
import type { SubteamRow, TeamPerson } from "@/modules/design/data";

/**
 * People × sub-team (Concept / Technical) grid. Tick a cell to put someone in a
 * sub-team; a person can be in both. Rows are the department's team members.
 */
export function SubteamsEditor({
  subteams,
  members,
  membership,
}: {
  subteams: SubteamRow[];
  members: TeamPerson[];
  membership: Record<string, boolean>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const toggle = (subteamId: string, userId: string, on: boolean) =>
    startTransition(async () => {
      setError(null);
      const res = await setSubteamMember(subteamId, userId, !on);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });

  if (members.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No one is on the Design team yet. Add people to the department in Team
        Access first, then assign them here.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-md border px-4 py-2 text-sm">
          {error}
        </div>
      )}
      <p className="text-muted-foreground text-sm">
        Tick which team each person works in. Concept covers the early design up
        to the Design Freeze; Technical covers the detailed work after it. Someone
        can be in both.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b">
              <th className="sticky left-0 bg-background py-2 pr-3 text-left font-medium">
                Person
              </th>
              {subteams.map((s) => (
                <th key={s.id} className="px-2 py-2 text-center font-medium">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.user_id} className="border-b last:border-0">
                <td className="sticky left-0 bg-background py-2 pr-3">
                  {m.full_name ?? m.email ?? m.user_id}
                </td>
                {subteams.map((s) => {
                  const on = membership[`${s.id}:${m.user_id}`] ?? false;
                  return (
                    <td key={s.id} className="px-1 py-1.5 text-center">
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => toggle(s.id, m.user_id, on)}
                        aria-pressed={on}
                        aria-label={`${on ? "Remove" : "Add"} ${m.full_name ?? m.email} ${on ? "from" : "to"} ${s.label}`}
                        className={cn(
                          "min-w-16 rounded-md px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50",
                          on
                            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                            : "text-muted-foreground hover:bg-muted"
                        )}
                      >
                        {on ? "In" : "—"}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
