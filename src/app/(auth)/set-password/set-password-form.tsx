"use client";

import { useActionState } from "react";

import { setPassword } from "@/core/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Choose-your-password form, shown once after an invite or a recovery link.
 * On success the Server Action redirects into the app, so there is no success
 * state to render here.
 */
export function SetPasswordForm() {
  const [state, action, pending] = useActionState(setPassword, null);

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          minLength={8}
          required
          autoFocus
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirm">Confirm password</Label>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          placeholder="Type it again"
          minLength={8}
          required
        />
      </div>

      {state && state.ok === false && (
        <p className="text-destructive text-sm">{state.error}</p>
      )}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Saving…" : "Save password and continue"}
      </Button>
    </form>
  );
}
