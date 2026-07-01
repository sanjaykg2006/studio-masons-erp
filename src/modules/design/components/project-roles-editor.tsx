"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ChevronDown, ChevronUp, Lock, Plus, Trash2 } from "lucide-react";

import { ACTIONS, ACTION_LABEL, type Action } from "@/core/rbac/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ProjectRoleRow } from "@/modules/design/data";

type ActionResult = { ok: true } | { ok: false; error: string };

/** A matrix row: a Design resource and the verbs it supports. */
export type ProjectRoleResource = { id: string; label: string; actions: Action[] };

type Props = {
  roles: ProjectRoleRow[];
  permissions: { role_id: string; resource: string; action: Action }[];
  resources: ProjectRoleResource[];
  /** Action handlers — injected so Design and other departments reuse this UI. */
  onCreate: (label: string) => Promise<ActionResult>;
  onDelete: (roleId: string) => Promise<ActionResult>;
  onMove: (roleId: string, up: boolean) => Promise<ActionResult>;
  onSetPermission: (
    roleId: string,
    resource: string,
    action: Action,
    grant: boolean
  ) => Promise<ActionResult>;
};

const cellKey = (roleId: string, resource: string, action: Action) =>
  `${roleId}:${resource}:${action}`;

/**
 * Self-service editor for the Design department's project roles. Create a role
 * and it appears here AND in every project's "add member" picker; tick its verbs
 * per resource (the same idea as the Access Control matrix). Pure UI — the
 * database (RLS + the 0013 RPCs) is the real boundary.
 */
export function ProjectRolesEditor({
  roles,
  permissions,
  resources,
  onCreate,
  onDelete,
  onMove,
  onSetPermission,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [newRole, setNewRole] = useState("");
  const [roleId, setRoleId] = useState<string | null>(roles[0]?.id ?? null);

  const selectedRole = roles.find((r) => r.id === roleId) ?? roles[0] ?? null;

  const granted = new Set(
    permissions.map((p) => cellKey(p.role_id, p.resource, p.action))
  );

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error);
      else router.refresh();
    });

  return (
    <div className="space-y-4">
      {error && (
        <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-md border px-4 py-2 text-sm">
          {error}
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-[220px_1fr]">
        {/* Roles list ---------------------------------------------------- */}
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs">
            Top = most senior. Order sets who a question climbs to when it&apos;s
            escalated. Use the arrows to reorder.
          </p>
          {roles.length === 0 && (
            <p className="text-muted-foreground text-sm">No project roles yet.</p>
          )}
          {roles.map((role, i) => (
            <div
              key={role.id}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                role.id === selectedRole?.id
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent/50"
              )}
            >
              <div className="flex flex-col">
                <button
                  type="button"
                  disabled={pending || i === 0}
                  onClick={() => run(() => onMove(role.id, true))}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                  aria-label={`Move ${role.label} up`}
                >
                  <ChevronUp className="size-3" />
                </button>
                <button
                  type="button"
                  disabled={pending || i === roles.length - 1}
                  onClick={() => run(() => onMove(role.id, false))}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                  aria-label={`Move ${role.label} down`}
                >
                  <ChevronDown className="size-3" />
                </button>
              </div>
              <button
                type="button"
                onClick={() => setRoleId(role.id)}
                className="flex flex-1 items-center gap-2 text-left"
              >
                {role.label}
                {role.is_system && (
                  <Lock className="text-muted-foreground size-3" />
                )}
              </button>
              {!role.is_system && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    if (confirm(`Delete role "${role.label}"?`))
                      run(() => onDelete(role.id));
                  }}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`Delete ${role.label}`}
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
          ))}

          <form
            className="flex gap-2 pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newRole.trim()) return;
              const label = newRole;
              setNewRole("");
              run(() => onCreate(label));
            }}
          >
            <Input
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
              placeholder="New role"
              className="h-8"
            />
            <Button type="submit" size="sm" disabled={pending}>
              <Plus className="size-4" />
            </Button>
          </form>
        </div>

        {/* Permission matrix -------------------------------------------- */}
        <div>
          {!selectedRole ? (
            <p className="text-muted-foreground text-sm">
              Create a role to set its permissions.
            </p>
          ) : (
            <>
              <p className="mb-3 text-sm font-medium">
                {selectedRole.label} — what this role can do on a project
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-muted-foreground border-b text-left">
                      <th className="py-2 font-medium">Area</th>
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
                        <td className="py-2 font-medium">{res.label}</td>
                        {ACTIONS.map((action) => {
                          // Only show a checkbox for actions this area actually
                          // uses; others are left blank (they'd have no effect).
                          if (!res.actions.includes(action)) {
                            return <td key={action} />;
                          }
                          const checked = granted.has(
                            cellKey(selectedRole.id, res.id, action)
                          );
                          return (
                            <td key={action} className="py-2 text-center">
                              <input
                                type="checkbox"
                                className="size-4 accent-primary"
                                checked={checked}
                                disabled={pending}
                                onChange={(e) =>
                                  run(() =>
                                    onSetPermission(
                                      selectedRole.id,
                                      res.id,
                                      action,
                                      e.target.checked
                                    )
                                  )
                                }
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
