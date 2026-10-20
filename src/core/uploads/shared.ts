/** Largest document anyone may upload, everywhere in the ERP. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB
export const TOO_LARGE = "File is larger than 25 MB.";

/** Where the browser parks a file before a server action takes it over. */
export const STAGING_BUCKET = "upload-staging";

/** What a form sends in place of a File once the bytes are staged. */
export type StagedFile = { staged: string; name: string; type: string; size: number };
