/**
 * Departments that have their own richer home page instead of the generic
 * /departments/[id] workspace (which only shows Tasks / People / Settings).
 * Keyed by department `key`; keep in sync with the dedicated routes under
 * src/app/(app)/<key>/. The generic department home redirects here when a key
 * is present, so every route in — including the Settings "back" arrow — lands
 * on the full hub rather than the stripped-down generic page.
 */
export const DEPARTMENT_HOME: Record<string, string> = {
  design: "/design",
  procurement: "/procurement",
  finance: "/finance",
};
