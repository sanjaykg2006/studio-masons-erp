import type { RejectionNote as Note } from "@/modules/access/rejection-notes";

/** "Turned down by X: <reason>" — shown to whoever has to act on it next. */
export function RejectionNote({ note, label = "Turned down" }: { note?: Note; label?: string }) {
  if (!note) return null;
  return (
    <div className="border-destructive/40 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-sm">
      {label}
      {note.by && ` by ${note.by}`}
      {note.note?.trim() ? `: “${note.note.trim()}”` : " (no reason given)."}
    </div>
  );
}
