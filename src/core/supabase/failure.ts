/**
 * Which database replies are a real fault worth an alert, as opposed to the
 * normal "no" a person is shown (not allowed, already exists, fill this in…).
 * Pure, so it can be tested.
 */

/** Database error codes that are an ordinary answer, not a fault. */
const EXPECTED_CODES = new Set([
  "P0001", // a rule in our own database code saying no, in plain words
  "42501", // not allowed (row-level security / permission)
  "PGRST116", // asked for exactly one row and there wasn't one
  "PGRST301", // signed-in session expired
  "PGRST302",
  "PGRST303",
]);

/**
 * Whether a failed reply from Supabase is unexpected.
 *  - Data (/rest/v1): any server error, and any client error that isn't an
 *    ordinary refusal — e.g. a function or column that doesn't exist (code
 *    shipped before its database change), or a query that timed out.
 *  - Files (/storage/v1): server errors only; a missing file is normal.
 *  - Sign-in (/auth/v1) is never watched: a wrong password isn't a fault, and
 *    recording an error itself checks the session, which would loop.
 */
export function isUnexpectedFailure(pathname: string, status: number, code?: string | null): boolean {
  if (status < 400) return false;
  if (pathname.startsWith("/rest/v1/")) {
    if (status >= 500) return true;
    if (status === 401) return false;
    if (!code) return true;
    if (EXPECTED_CODES.has(code)) return false;
    // Integrity (23…) and bad input (22…) are things the person typed.
    return !(code.startsWith("23") || code.startsWith("22"));
  }
  if (pathname.startsWith("/storage/v1/")) return status >= 500;
  return false;
}
