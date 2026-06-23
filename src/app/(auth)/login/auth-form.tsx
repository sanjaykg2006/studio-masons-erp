"use client";

import { useActionState, useState } from "react";

import {
  signIn,
  signUp,
  signInWithMagicLink,
} from "@/core/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Mode = "signin" | "signup" | "magic";

/**
 * The login form. Three sign-in methods share one UI:
 *   - signin / signup  → email + password (Server Action: signIn / signUp)
 *   - magic            → passwordless email link (Server Action: signInWithMagicLink)
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
  const [signupState, signupAction, signupPending] = useActionState(
    signUp,
    null
  );
  const [magicState, magicAction, magicPending] = useActionState(
    signInWithMagicLink,
    null
  );

  const action =
    mode === "signin"
      ? signinAction
      : mode === "signup"
        ? signupAction
        : magicAction;
  const pending =
    mode === "signin"
      ? signinPending
      : mode === "signup"
        ? signupPending
        : magicPending;
  const errorState =
    mode === "signin" ? signinState : mode === "signup" ? signupState : magicState;

  return (
    <div className="space-y-4">
      <div className="bg-muted text-muted-foreground grid grid-cols-3 gap-1 rounded-lg p-1 text-sm">
        {(
          [
            ["signin", "Sign in"],
            ["signup", "Sign up"],
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

        {mode !== "magic" && (
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete={
                mode === "signup" ? "new-password" : "current-password"
              }
              placeholder="••••••••"
              minLength={6}
              required
            />
          </div>
        )}

        {errorState && errorState.ok === false && (
          <p className="text-destructive text-sm">{errorState.error}</p>
        )}

        {mode === "signup" && signupState?.ok && (
          <p className="text-sm text-green-600 dark:text-green-500">
            Check your email to confirm your account, then sign in.
          </p>
        )}
        {mode === "magic" && magicState?.ok && (
          <p className="text-sm text-green-600 dark:text-green-500">
            Magic link sent — check your email to finish signing in.
          </p>
        )}

        <Button type="submit" className="w-full" disabled={pending}>
          {pending
            ? "Please wait…"
            : mode === "signin"
              ? "Sign in"
              : mode === "signup"
                ? "Create account"
                : "Send magic link"}
        </Button>
      </form>
    </div>
  );
}
