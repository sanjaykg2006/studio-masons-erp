"use client";

import Link from "next/link";
import { Lock } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { rankLabel, rankTone } from "@/modules/design/components/folder-detail";
import type { ProjectFolder } from "@/modules/projects/types";

/** The controlled folder structure for a project — only folders the user can see. */
export function FoldersCard({
  projectId,
  folders,
}: {
  projectId: string;
  folders: ProjectFolder[];
}) {
  const visible = folders.filter((f) => f.rank >= 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Project folders</CardTitle>
        <CardDescription>
          The controlled folder structure. You see the folders your role can access.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {visible.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            You don&apos;t have access to any folders on this project yet.
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {visible.map((f) => (
              <li key={f.folder_key}>
                <Link
                  href={`/projects/${projectId}/folder/${f.folder_key}`}
                  className="hover:bg-muted/50 flex items-center justify-between gap-2 rounded-md border px-3 py-2 transition-colors"
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {f.label}
                    {f.locked && <Lock className="text-muted-foreground size-3.5" />}
                  </span>
                  <span className={rankTone(f.rank)}>{rankLabel(f.rank)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
