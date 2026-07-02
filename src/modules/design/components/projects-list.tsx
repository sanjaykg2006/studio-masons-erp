"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { DesignProject } from "@/modules/projects/types";
import { createProject } from "@/modules/design/actions";
import {
  ProjectPhaseBadge,
  ProjectStatusBadge,
} from "@/modules/design/components/status-badge";

export function ProjectsList({
  projects,
  canCreate,
  canTemplates,
}: {
  projects: DesignProject[];
  canCreate: boolean;
  canTemplates: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", code: "", client: "", location: "" });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    startTransition(async () => {
      setError(null);
      const res = await createProject(form.name, form.code, form.client, form.location);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setForm({ name: "", code: "", client: "", location: "" });
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="text-muted-foreground">
            Every department&apos;s projects. You see the projects you&apos;re a
            member of.
          </p>
        </div>
        <div className="flex gap-2">
          {canTemplates && (
            <Button asChild size="sm" variant="outline">
              <Link href="/projects/templates">Templates</Link>
            </Button>
          )}
          {canCreate && (
            <Button onClick={() => setOpen((o) => !o)} size="sm">
              <Plus className="size-4" /> New project
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-md border px-4 py-2 text-sm">
          {error}
        </div>
      )}

      {open && canCreate && (
        <Card>
          <CardHeader>
            <CardTitle>New project</CardTitle>
            <CardDescription>
              Starts as a draft — not yet created in the company database.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
              <Input
                placeholder="Project name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                aria-label="Project name"
              />
              <Input
                placeholder="Code (e.g. HCA)"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                aria-label="Project code"
              />
              <Input
                placeholder="Client"
                value={form.client}
                onChange={(e) => setForm({ ...form, client: e.target.value })}
                aria-label="Client"
              />
              <Input
                placeholder="Location"
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                aria-label="Location"
              />
              <div className="sm:col-span-2">
                <Button type="submit" size="sm" disabled={pending}>
                  Create draft
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          {projects.length === 0 ? (
            <p className="text-muted-foreground text-sm">No projects yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left">
                  <th className="py-2 font-medium">Project</th>
                  <th className="py-2 font-medium">Code</th>
                  <th className="py-2 font-medium">Client</th>
                  <th className="py-2 font-medium">Phase</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="py-2 font-medium">
                      <Link href={`/projects/${p.id}`} className="hover:underline">
                        {p.name}
                      </Link>
                    </td>
                    <td className="text-muted-foreground py-2">{p.code ?? "—"}</td>
                    <td className="text-muted-foreground py-2">{p.client ?? "—"}</td>
                    <td className="py-2">
                      <ProjectPhaseBadge phase={p.phase} />
                    </td>
                    <td className="py-2">
                      <ProjectStatusBadge status={p.status} />
                    </td>
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
