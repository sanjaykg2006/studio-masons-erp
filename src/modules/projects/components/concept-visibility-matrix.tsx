"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { setConceptVisibility } from "@/modules/projects/actions";
import type { ConceptVisibility } from "@/modules/projects/data";

/**
 * Who can see a project while it is still in Concept — the rule that used to be
 * hardcoded as "only the department that owns it".
 *
 * Rows are the department that OWNS the project, columns the department whose
 * people may see it early. The diagonal is fixed: a department always sees its
 * own work. Once a project is frozen into Execution every assigned team sees it
 * regardless, so this grid only governs the period before the Design Freeze.
 *
 * Ticking a box is not a grant on its own — someone still has to be a member of
 * the project with a role that can read it.
 */
export function ConceptVisibilityMatrix({ data }: { data: ConceptVisibility }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Mirrors the server so a click feels immediate; reconciled by router.refresh.
  const [allowed, setAllowed] = useState(data.allowed);

  const key = (owner: string, viewer: string) => `${owner}:${viewer}`;

  const toggle = (owner: string, viewer: string) => {
    const k = key(owner, viewer);
    const next = !allowed.has(k);
    setAllowed((prev) => {
      const copy = new Set(prev);
      if (next) copy.add(k);
      else copy.delete(k);
      return copy;
    });
    startTransition(async () => {
      setError(null);
      const res = await setConceptVisibility(owner, viewer, next);
      if (!res.ok) {
        setError(res.error);
        setAllowed(data.allowed); // put the grid back
      }
      router.refresh();
    });
  };

  if (data.departments.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Who sees a project before the Design Freeze</CardTitle>
        <CardDescription>
          While a project is still in <strong>Concept</strong>, only the ticked
          departments can see it. After the Design Freeze every assigned team
          sees it regardless. A department always sees its own projects, and
          people still need to be a member of the project either way.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && <p className="text-destructive mb-2 text-sm">{error}</p>}
        <div className="overflow-x-auto">
          <table className="text-sm">
            <thead>
              <tr className="text-muted-foreground text-xs">
                <th className="py-1 pr-4 text-left font-medium">
                  Project owned by ↓ · seen by →
                </th>
                {data.departments.map((d) => (
                  <th key={d.id} className="min-w-24 px-2 py-1 font-medium">
                    {d.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.departments.map((owner) => (
                <tr key={owner.id} className="border-t">
                  <td className="py-1 pr-4 font-medium">{owner.label}</td>
                  {data.departments.map((viewer) => {
                    const self = owner.id === viewer.id;
                    return (
                      <td key={viewer.id} className="px-2 py-1 text-center">
                        <input
                          type="checkbox"
                          checked={self || allowed.has(key(owner.id, viewer.id))}
                          disabled={self || pending}
                          onChange={() => toggle(owner.id, viewer.id)}
                          className="size-4 align-middle"
                          aria-label={`${viewer.label} can see ${owner.label} projects during Concept`}
                          title={
                            self
                              ? "A department always sees its own projects"
                              : undefined
                          }
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
