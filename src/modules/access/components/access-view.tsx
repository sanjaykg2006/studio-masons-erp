"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Lock, Plus, Trash2 } from "lucide-react";

import { ACTIONS, type Action, type Role, type RolePermission } from "@/core/rbac/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { AccessUser } from "@/modules/access/data";
import {
  assignUserRole,
  createRole,
  deleteRole,
  setPermission,
} from "@/modules/access/actions";

/** A gated resource (module) shown as a row in the permission matrix. */
export type AccessResource = { id: string; label: string; actions: Action[] };

type Props = {
  roles: Role[];
  permissions: RolePermission[];
  users: AccessUser[];
  resources: AccessResource[];
};

const grantKey = (roleId: string, resource: string, action: Action) =>
  `${roleId}:${resource}:${action}`;

export function AccessView({ roles, permissions, users, resources }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [newRole, setNewRole] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(
    roles[0]?.id ?? null
  );

  const selected = roles.find((r) => r.id === selectedId) ?? null;

  // Fast lookups: explicit grants, and per-role wildcard actions.
  const granted = new Set(
    permissions.map((p) => grantKey(p.role_id, p.resource, p.action))
  );
  const wildcard = new Set(
    permissions
      .filter((p) => p.resource === "*")
      .map((p) => `${p.role_id}:${p.action}`)
  );

  /** Run a server action, surface its error, and refresh server data. */
  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error);
      else router.refresh();
    });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Access Control</h1>
        <p className="text-muted-foreground">
          Manage roles, what each role can do, and who holds which role.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        {/* Roles list ------------------------------------------------------ */}
        <Card>
          <CardHeader>
            <CardTitle>Roles</CardTitle>
            <CardDescription>Select a role to edit its access.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {roles.map((role) => (
              <div
                key={role.id}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                  role.id === selectedId
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50"
                )}
              >
                <button
                  type="button"
                  onClick={() => setSelectedId(role.id)}
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
                    onClick={() => run(() => deleteRole(role.id))}
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
                run(() => createRole(newRole));
                setNewRole("");
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
          </CardContent>
        </Card>

        {/* Permission matrix ---------------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle>
              {selected ? `${selected.label} — permissions` : "Permissions"}
            </CardTitle>
            <CardDescription>
              Tick an action to grant it. System-wide (★) access is managed in
              the database, not here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!selected ? (
              <p className="text-muted-foreground text-sm">Select a role.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-left">
                    <th className="py-2 font-medium">Module</th>
                    {ACTIONS.map((a) => (
                      <th key={a} className="py-2 text-center font-medium capitalize">
                        {a}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {resources.map((res) => (
                    <tr key={res.id} className="border-b last:border-0">
                      <td className="py-2 font-medium">{res.label}</td>
                      {ACTIONS.map((action) => {
                        const supported = res.actions.includes(action);
                        const isWildcard = wildcard.has(
                          `${selected.id}:${action}`
                        );
                        const checked =
                          isWildcard ||
                          granted.has(grantKey(selected.id, res.id, action));
                        return (
                          <td key={action} className="py-2 text-center">
                            {supported ? (
                              <input
                                type="checkbox"
                                className="size-4 accent-primary"
                                checked={checked}
                                disabled={pending || isWildcard}
                                title={isWildcard ? "Granted system-wide (★)" : undefined}
                                onChange={(e) =>
                                  run(() =>
                                    setPermission(
                                      selected.id,
                                      res.id,
                                      action,
                                      e.target.checked
                                    )
                                  )
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
            )}
          </CardContent>
        </Card>
      </div>

      {/* Members --------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>Assign each user a role.</CardDescription>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-b text-left">
                <th className="py-2 font-medium">User</th>
                <th className="py-2 font-medium">Role</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b last:border-0">
                  <td className="py-2">{u.full_name ?? u.email ?? u.id}</td>
                  <td className="py-2">
                    <select
                      className="border-input bg-background h-8 rounded-md border px-2"
                      value={u.role_id ?? ""}
                      disabled={pending}
                      onChange={(e) =>
                        run(() =>
                          assignUserRole(u.id, e.target.value || null)
                        )
                      }
                    >
                      <option value="">— none —</option>
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
