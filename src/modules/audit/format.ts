/**
 * Pure presentation helpers for the audit log. Kept separate from the view so
 * they can be unit-tested without rendering.
 */

/** Who performed an action — falls back to "System" for unattributed entries. */
export function actorLabel(email: string | null): string {
  return email?.trim() || "System";
}

/**
 * Turn a machine action code into a readable label.
 * e.g. "user.invite" -> "User invite", "permission.update" -> "Permission update".
 */
export function actionLabel(action: string): string {
  const words = action.split(/[._-]+/).filter(Boolean);
  if (words.length === 0) return action;
  return words
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}
