"use server";

import { getUser } from "@/core/auth/get-user";
import { createAdminClient } from "@/core/supabase/admin";
import { MAX_UPLOAD_BYTES, STAGING_BUCKET, TOO_LARGE } from "@/core/uploads/shared";

/**
 * A one-time ticket for the browser to put one file into the staging bucket.
 * The path sits under the caller's own id, so takeUpload only ever hands a
 * person back the files they staged themselves.
 */
export async function stageUpload(
  name: string,
  size: number
): Promise<{ ok: true; path: string; token: string } | { ok: false; error: string }> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Not signed in." };
  if (size > MAX_UPLOAD_BYTES) return { ok: false, error: TOO_LARGE };

  const safeName = name.replace(/[^\w.\- ]+/g, "_");
  const path = `${user.id}/${crypto.randomUUID()}-${safeName}`;
  const { data, error } = await createAdminClient()
    .storage.from(STAGING_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: error?.message ?? "Could not start the upload." };
  return { ok: true, path, token: data.token };
}
