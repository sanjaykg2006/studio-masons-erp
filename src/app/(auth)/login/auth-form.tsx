"use client";

import { useActionState, useState } from "react";

import { signIn, signInWithMagicLink } from "@/core/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Mode = "signin" | "magic";

/**
 * Login form for an invite-only ERP — sign-in only, no self-registration.
 * Two methods for existing accounts:
 *   - signin → email + password   (Server Action: signIn)
 *   - magic  → passwordless link   (Server Action: signInWithMagicLink)
 *
 * Adding Microsoft Entra ID SSO later means dropping an OAuth button here that
 * calls supabase.auth.signInWithOAuth({ provider: "azure" }). No other change.
 */
export function AuthForm({ redirectTo }: { redirectTo: string }) {
  const [mode, setMode] = useState<Mode>("signin");

  const [signinState, signinAction, signinPending] = useActionState(
    signIn,
    null
  );
  const [magicState, magicAction, magicPending] = useActionState(
    signInWithMagicLink,
    null
  );

  const action = mode === "signin" ? signinAction : magicAction;
  const pending = mode === "signin" ? signinPending : magicPending;
  const errorState = mode === "signin" ? signinState : magicState;

  return (
    <div className="space-y-4">
      <div className="bg-muted text-muted-foreground grid grid-cols-2 gap-1 rounded-lg p-1 text-sm">
        {(
          [
            ["signin", "Password"],
            ["magic", "Magic link"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            className={cn(
              "rounded-md px-2 py-1.5 font-medium transition-colors",
              mode === value
                ? "bg-background text-foreground shadow-sm"
                : "hover:text-foreground"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <form action={action} className="space-y-4">
        <input type="hidden" name="redirectTo" value={redirectTo} />

        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@studio-masons.com"
            required
          />
        </div>

        {mode === "signin" && (
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              required
            />
          </div>
        )}

        {errorState && errorState.ok === false && (
          <p className="text-destructive text-sm">{errorState.error}</p>
        )}

        {mode === "magic" && magicState?.ok && (
          <p className="text-sm text-green-600 dark:text-green-500">
            If that account exists, a sign-in link is on its way — check your
            email.
          </p>
        )}

        <Button type="submit" className="w-full" disabled={pending}>
          {pending
            ? "Please wait…"
            : mode === "signin"
              ? "Sign in"
              : "Send magic link"}
        </Button>
      </form>
    </div>
  );
}
