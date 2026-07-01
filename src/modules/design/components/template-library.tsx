"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";

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
import { createTemplate, deleteTemplate } from "@/modules/design/actions";

export function TemplateLibrary({
  templates,
  canCreate,
  canDelete,
  scope,
  basePath,
  backHref,
  backLabel,
  heading,
  description,
}: {
  templates: TemplateSummary[];
  canCreate: boolean;
  canDelete: boolean;
  scope: "general" | "design";
  basePath: string;
  backHref: string;
  backLabel: string;
  heading: string;
  description: string;
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
      const res = await createTemplate(name, discipline, scope);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setName("");
      router.refresh();
    });
  };

  const remove = (id: string, label: string) => {
    if (!confirm(`Delete template "${label}"? This can't be undone.`)) return;
    startTransition(async () => {
      setError(null);
      const res = await deleteTemplate(id);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      <Link
        href={backHref}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" /> {backLabel}
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{heading}</h1>
        <p className="text-muted-foreground">{description}</p>
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
                  {canDelete && <th className="py-2" />}
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id} className="border-b last:border-0">
                    <td className="py-2 font-medium">
                      <Link href={`${basePath}/${t.id}`} className="hover:underline">
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
                    {canDelete && (
                      <td className="py-2 text-right">
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => remove(t.id, t.label)}
                          className="text-muted-foreground hover:text-destructive"
                          aria-label={`Delete ${t.label}`}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </td>
                    )}
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
