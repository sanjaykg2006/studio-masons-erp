"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { cn } from "@/lib/utils";
import { setFolderAccess } from "@/modules/design/actions";
import type { DesignRole } from "@/modules/design/data";
import {
  FOLDER_CAPABILITY_LABEL,
  FOLDER_CAPABILITY_ORDER,
  type DesignFolderType,
  type FolderCapability,
} from "@/modules/design/types";

const CELL_TONE: Record<FolderCapability, string> = {
  view: "bg-muted text-muted-foreground",
  edit: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  approve: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
};

/** Editable grid of folder × role → capability. Click a cell to cycle the level. */
export function FolderAccessMatrix({
  folders,
  roles,
  access,
}: {
  folders: DesignFolderType[];
  roles: DesignRole[];
  access: Record<string, FolderCapability>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const next = (cap: FolderCapability | null): FolderCapability | null => {
    const i = FOLDER_CAPABILITY_ORDER.indexOf(cap);
    return FOLDER_CAPABILITY_ORDER[(i + 1) % FOLDER_CAPABILITY_ORDER.length];
  };

  const cycle = (folderKey: string, roleId: string, cap: FolderCapability | null) =>
    startTransition(async () => {
      setError(null);
      const res = await setFolderAccess(folderKey, roleId, next(cap));
      if (!res.ok) setError(res.error);
      else router.refresh();
    });

  return (
    <div className="space-y-3">
      {error && (
        <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-md border px-4 py-2 text-sm">
          {error}
        </div>
      )}
      <p className="text-muted-foreground text-sm">
        Click a cell to cycle: <span className="font-medium">— → View → Edit → Approve</span>.
        Approve includes edit and view; edit includes view. Empty means no access.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b">
              <th className="sticky left-0 bg-background py-2 pr-3 text-left font-medium">
                Folder
              </th>
              {roles.map((r) => (
                <th key={r.id} className="px-2 py-2 text-center font-medium">
                  {r.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {folders.map((f) => (
              <tr key={f.key} className="border-b last:border-0">
                <td className="sticky left-0 bg-background py-2 pr-3">
                  <div className="font-medium">{f.label}</div>
                  {f.description && (
                    <div className="text-muted-foreground text-xs">{f.description}</div>
                  )}
                </td>
                {roles.map((r) => {
                  const cap = access[`${f.key}:${r.id}`] ?? null;
                  return (
                    <td key={r.id} className="px-1 py-1.5 text-center">
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => cycle(f.key, r.id, cap)}
                        className={cn(
                          "min-w-16 rounded-md px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50",
                          cap ? CELL_TONE[cap] : "text-muted-foreground hover:bg-muted"
                        )}
                      >
                        {cap ? FOLDER_CAPABILITY_LABEL[cap] : "—"}
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
