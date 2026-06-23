/**
 * Pure input validation for the access module. Lives outside actions.ts (a
 * "use server" file, whose every export must be an async action) so these
 * helpers can be imported and unit-tested directly.
 */

/** Loose-but-practical email check: one @, a dot in the domain, no spaces. */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
