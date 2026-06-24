"use client";

import {
  ACTIONS,
  ACTION_LABEL,
  type Action,
  type Role,
} from "@/core/rbac/types";

/** A gated resource (module) shown as a row in the permission matrix. */
export type AccessResource = { id: string; label: string; actions: Action[] };

export const grantKey = (roleId: string, resource: string, action: Action) =>
  `${roleId}:${resource}:${action}`;

type Props = {
  /** The role whose grants are being edited (one column set). */
  role: Role;
  /** Rows to render — already filtered to the modules this role may hold. */
  resources: AccessResource[];
  /** Explicit grants, as `roleId:resource:action` keys. */
  granted: Set<string>;
  /** Per-role wildcard actions, as `roleId:action` keys (shown ticked + locked). */
  wildcard: Set<string>;
  /** Module ids flagged "general" — they keep their declared verb set only. */
  generalSet: Set<string>;
  disabled?: boolean;
  onToggle: (resource: string, action: Action, checked: boolean) => void;
};

/**
 * The role × verb grid, shared by the central Access Control page (global roles)
 * and each department's Team Access page (that department's roles). Pure
 * presentation: the caller decides which rows to pass and what a toggle does; the
 * database (RLS) is the real boundary.
 */
export function PermissionMatrix({
  role,
  resources,
  granted,
  wildcard,
  generalSet,
  disabled,
  onToggle,
}: Props) {
  if (resources.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No modules are available to this role yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted-foreground border-b text-left">
            <th className="py-2 font-medium">Module</th>
            {ACTIONS.map((a) => (
              <th key={a} className="px-2 py-2 text-center font-medium">
                {ACTION_LABEL[a]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {resources.map((res) => (
            <tr key={res.id} className="border-b last:border-0">
              <td className="py-2 font-medium">
                {res.label}
                {generalSet.has(res.id) && (
                  <span className="text-muted-foreground ml-1 text-xs">
                    (general)
                  </span>
                )}
              </td>
              {ACTIONS.map((action) => {
                // Business modules are fully open (every verb grantable);
                // general/admin modules keep their declared verb set.
                const supported = generalSet.has(res.id)
                  ? res.actions.includes(action)
                  : true;
                const isWildcard = wildcard.has(`${role.id}:${action}`);
                const checked =
                  isWildcard || granted.has(grantKey(role.id, res.id, action));
                return (
                  <td key={action} className="py-2 text-center">
                    {supported ? (
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={checked}
                        disabled={disabled || isWildcard}
                        title={isWildcard ? "Granted system-wide (★)" : undefined}
                        onChange={(e) =>
                          onToggle(res.id, action, e.target.checked)
                        }
                      />
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
