"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";
import { ArrowLeft, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DISCIPLINE_LABEL, type Discipline } from "@/modules/design/types";
import type { TemplateSummary } from "@/modules/design/data";
import { createTemplate } from "@/modules/design/actions";

export function TemplateLibrary({
  templates,
  canCreate,
}: {
  templates: TemplateSummary[];
  canCreate: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [discipline, setDiscipline] = useState<Discipline>("interior");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    startTransition(async () => {
      setError(null);
      const res = await createTemplate(name, discipline);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setName("");
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      <Link
        href="/design"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" /> Design Department
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Brief templates</h1>
        <p className="text-muted-foreground">
          The questionnaires that power project briefs. Editing publishes a new
          version; briefs already filled keep the version they used.
        </p>
      </div>

      {error && (
        <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-md border px-4 py-2 text-sm">
          {error}
        </div>
      )}

      <Card>
        <CardContent className="pt-6">
          {templates.length === 0 ? (
            <p className="text-muted-foreground text-sm">No templates yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left">
                  <th className="py-2 font-medium">Template</th>
                  <th className="py-2 font-medium">Discipline</th>
                  <th className="py-2 font-medium">Published</th>
                  <th className="py-2 font-medium">State</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id} className="border-b last:border-0">
                    <td className="py-2 font-medium">
                      <Link href={`/design/templates/${t.id}`} className="hover:underline">
                        {t.label}
                      </Link>
                    </td>
                    <td className="text-muted-foreground py-2">
                      {DISCIPLINE_LABEL[t.discipline]}
                    </td>
                    <td className="text-muted-foreground py-2">
                      {t.publishedVersion ? `v${t.publishedVersion}` : "—"}
                    </td>
                    <td className="text-muted-foreground py-2">
                      {t.hasDraft ? "Draft in progress" : "Published"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {canCreate && (
        <Card>
          <CardHeader>
            <CardTitle>New template</CardTitle>
            <CardDescription>Starts empty as draft v1.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
              <Input
                placeholder="Template name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="sm:flex-1"
                aria-label="Template name"
              />
              <select
                className="border-input bg-background h-9 rounded-md border px-2"
                value={discipline}
                onChange={(e) => setDiscipline(e.target.value as Discipline)}
                aria-label="Discipline"
              >
                <option value="interior">Interior Design</option>
                <option value="mep">MEP</option>
              </select>
              <Button type="submit" size="sm" disabled={pending}>
                <Plus className="size-4" /> Create
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
