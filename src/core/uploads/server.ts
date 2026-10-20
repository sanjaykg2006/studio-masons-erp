import "server-only";

import { getUser } from "@/core/auth/get-user";
import { createAdminClient } from "@/core/supabase/admin";
import { STAGING_BUCKET, type StagedFile } from "@/core/uploads/shared";

/** Turn one form entry back into a File: a real one, or a staged descriptor. */
async function resolve(entry: FormDataEntryValue | null): Promise<File | null> {
  if (entry instanceof File) return entry;
  if (typeof entry !== "string" || !entry.startsWith("{")) return null;

  let meta: StagedFile;
  try {
    meta = JSON.parse(entry) as StagedFile;
  } catch {
    return null;
  }
  const user = await getUser();
  if (!user || typeof meta.staged !== "string" || !meta.staged.startsWith(`${user.id}/`)) return null;

  const staging = createAdminClient().storage.from(STAGING_BUCKET);
  const { data, error } = await staging.download(meta.staged);
  if (error || !data) return null;
  await staging.remove([meta.staged]);
  return new File([data], meta.name, { type: meta.type });
}

/**
 * The file a form sent under `key`. The browser stages large files first (see
 * client.ts) and sends a small descriptor instead, so callers read uploads
 * through this rather than formData.get.
 */
export async function takeUpload(formData: FormData, key: string): Promise<File | null> {
  return resolve(formData.get(key));
}

/** Whether the form carries any file under `key`, without taking it. */
export function hasUpload(formData: FormData, key: string): boolean {
  return formData
    .getAll(key)
    .some((f) => (f instanceof File ? f.size > 0 : typeof f === "string" && f.startsWith("{")));
}

/** Every file a form sent under `key` (multi-file inputs). */
export async function takeUploads(formData: FormData, key: string): Promise<File[]> {
  const files = await Promise.all(formData.getAll(key).map(resolve));
  return files.filter((f): f is File => f !== null);
}
