"use client";

import { createClient } from "@/core/supabase/client";
import { stageUpload } from "@/core/uploads/actions";
import { MAX_UPLOAD_BYTES, STAGING_BUCKET, TOO_LARGE, type StagedFile } from "@/core/uploads/shared";

/**
 * Send every file in `formData` straight to storage, swapping each for a small
 * descriptor, so the server action's request stays under Vercel's ~4.5 MB body
 * limit. Returns the same FormData ready to pass on, or the first error.
 */
export async function stageFiles(
  formData: FormData
): Promise<{ ok: true; formData: FormData } | { ok: false; error: string }> {
  const files = [...formData.entries()].filter(
    (e): e is [string, File] => e[1] instanceof File && e[1].size > 0
  );
  if (files.some(([, f]) => f.size > MAX_UPLOAD_BYTES)) return { ok: false, error: TOO_LARGE };
  if (!files.length) return { ok: true, formData };

  const supabase = createClient();
  const out = new FormData();
  for (const [key, value] of formData.entries()) {
    if (!(value instanceof File) || value.size === 0) {
      out.append(key, value);
      continue;
    }
    const ticket = await stageUpload(value.name, value.size);
    if (!ticket.ok) return ticket;
    const { error } = await supabase.storage
      .from(STAGING_BUCKET)
      .uploadToSignedUrl(ticket.path, ticket.token, value, { contentType: value.type || undefined });
    if (error) return { ok: false, error: error.message };
    const meta: StagedFile = { staged: ticket.path, name: value.name, type: value.type, size: value.size };
    out.append(key, JSON.stringify(meta));
  }
  return { ok: true, formData: out };
}

/** Stage the form's files, then call `send` with the lightweight form. */
export async function sendWithFiles<R>(
  formData: FormData,
  send: (formData: FormData) => Promise<R>
): Promise<R | { ok: false; error: string }> {
  const staged = await stageFiles(formData);
  return staged.ok ? send(staged.formData) : staged;
}
