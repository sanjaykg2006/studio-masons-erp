"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { ArrowLeft, Download, FileText, Lock, Send, Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  deleteFile,
  getFileDownloadUrl,
  issueFiles,
  uploadFile,
} from "@/modules/design/actions";
import type { DesignFile, ProjectFolder } from "@/modules/design/types";

function formatBytes(n: number | null): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function FolderDetail({
  projectId,
  projectName,
  folder,
  files,
  canWrite,
  canIssue,
}: {
  projectId: string;
  projectName: string;
  folder: ProjectFolder;
  files: DesignFile[];
  canWrite: boolean;
  canIssue: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const fileInput = useRef<HTMLInputElement>(null);

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error);
      else router.refresh();
    });

  const onUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const data = new FormData();
    data.set("file", file);
    run(async () => {
      const res = await uploadFile(projectId, folder.folder_key, data);
      if (fileInput.current) fileInput.current.value = "";
      return res;
    });
  };

  const download = (fileId: string) =>
    startTransition(async () => {
      setError(null);
      const res = await getFileDownloadUrl(fileId);
      if (!res.ok) setError(res.error);
      else window.open(res.url, "_blank");
    });

  const togglePick = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-6">
      <Link
        href={`/projects/${projectId}`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" /> {projectName}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{folder.label}</h1>
            {folder.locked && (
              <span className="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium">
                <Lock className="size-3" /> Locked
              </span>
            )}
          </div>
          {folder.description && (
            <p className="text-muted-foreground mt-1 text-sm">{folder.description}</p>
          )}
        </div>
        {canWrite && (
          <div>
            <input
              ref={fileInput}
              type="file"
              className="hidden"
              onChange={onUpload}
              disabled={pending}
            />
            <Button size="sm" disabled={pending} onClick={() => fileInput.current?.click()}>
              <Upload className="size-4" /> Upload
            </Button>
          </div>
        )}
      </div>

      {folder.locked && (
        <div className="border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300 rounded-md border px-4 py-2 text-sm">
          This folder is frozen at the project&apos;s current stage. Changes must go
          through a change request.
        </div>
      )}

      {error && (
        <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-md border px-4 py-2 text-sm">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Files</CardTitle>
          <CardDescription>
            {files.length} file{files.length === 1 ? "" : "s"} in this folder.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {files.length === 0 ? (
            <p className="text-muted-foreground text-sm">No files yet.</p>
          ) : (
            <ul className="space-y-2">
              {files.map((f) => (
                <li
                  key={f.id}
                  className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {canIssue && (
                      <input
                        type="checkbox"
                        className="accent-primary size-4"
                        checked={picked.has(f.id)}
                        onChange={() => togglePick(f.id)}
                        aria-label={`Select ${f.name}`}
                      />
                    )}
                    <FileText className="text-muted-foreground size-4 shrink-0" />
                    <span className="truncate text-sm font-medium">{f.name}</span>
                    {f.version_no > 1 && (
                      <span className="text-muted-foreground text-xs">v{f.version_no}</span>
                    )}
                    {!f.is_current && (
                      <span className="text-muted-foreground text-xs">(superseded)</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-muted-foreground hidden text-xs sm:inline">
                      {formatBytes(f.size_bytes)}
                    </span>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => download(f.id)}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label="Download"
                    >
                      <Download className="size-4" />
                    </button>
                    {canWrite && (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => {
                          if (confirm(`Delete "${f.name}"?`)) run(() => deleteFile(f.id));
                        }}
                        className="text-muted-foreground hover:text-destructive"
                        aria-label="Delete"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {canIssue && files.length > 0 && (
            <div className="border-t pt-4">
              <p className="text-muted-foreground mb-2 text-sm">
                Select files above and issue them as the controlled GFC package.
              </p>
              <Button
                size="sm"
                disabled={pending || picked.size === 0}
                onClick={() =>
                  run(async () => {
                    const res = await issueFiles(projectId, [...picked]);
                    if (res.ok) setPicked(new Set());
                    return res;
                  })
                }
              >
                <Send className="size-4" /> Issue {picked.size > 0 ? `${picked.size} ` : ""}to GFC
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Capability label from a rank, for the folders overview. */
export function rankLabel(rank: number): string {
  return rank >= 3 ? "Approve" : rank === 2 ? "Edit" : rank === 1 ? "View" : "—";
}

/** A small swatch tone for a capability rank. */
export function rankTone(rank: number): string {
  return cn(
    "rounded-full px-2 py-0.5 text-xs font-medium",
    rank >= 3
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
      : rank === 2
        ? "bg-blue-500/15 text-blue-700 dark:text-blue-400"
        : "bg-muted text-muted-foreground"
  );
}
