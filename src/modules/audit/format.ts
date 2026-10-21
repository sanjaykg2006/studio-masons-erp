/**
 * Pure presentation helpers for the audit log. Kept separate from the view so
 * they can be unit-tested without rendering.
 */

/** Who performed an action — the person's name, falling back to their email (for
 *  older entries with no name snapshot), then "System" for unattributed ones. */
export function actorLabel(name: string | null, email: string | null): string {
  return name?.trim() || email?.trim() || "System";
}

/** The stand-ins actions about a person used before the log named them. */
const PERSON_PHRASES: [RegExp, (name: string, match: string[]) => string][] = [
  [/\{person\}/g, (n) => n],
  [/\ba user's\b/g, (n) => `${n}'s`],
  [/\b(Appointed|Removed) a department lead\b/g, (n, m) => `${m[1]} ${n} as department lead`],
  [/\ba (?:user|teammate|project member|person)\b/g, (n) => n],
];

/**
 * Put the person an entry is about into its summary: "{person}" in new
 * entries, and the generic "a teammate" / "a user" / "a project member" … that
 * older entries used. Left as it is when the name isn't known.
 */
export function namePerson(summary: string, name: string | null): string {
  const n = name?.trim();
  if (!n) return summary;
  return PERSON_PHRASES.reduce(
    (s, [re, to]) => s.replace(re, (...m: string[]) => to(n, m)),
    summary
  );
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
