"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { createClient } from "@/core/supabase/server";
import { env } from "@/core/config/env";
import type { AuthResult } from "@/core/auth/types";

/** Build an absolute URL for auth redirects (env override, else request host). */
async function siteOrigin() {
  if (env.NEXT_PUBLIC_SITE_URL) return env.NEXT_PUBLIC_SITE_URL;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host")!;
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

/** Email + password sign in. On success, redirects into the app. */
export async function signIn(
  _prev: AuthResult | null,
  formData: FormData
): Promise<AuthResult> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const redirectTo = String(formData.get("redirectTo") ?? "/dashboard");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/", "layout");
  redirect(redirectTo || "/dashboard");
}

/**
 * Passwordless magic-link sign in for EXISTING accounts only.
 *
 * shouldCreateUser:false enforces the invite-only model — a link is only sent
 * to a user that already exists; it never self-registers a new account.
 */
export async function signInWithMagicLink(
  _prev: AuthResult | null,
  formData: FormData
): Promise<AuthResult> {
  const email = String(formData.get("email") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${await siteOrigin()}/auth/callback`,
    },
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Set (or replace) the signed-in user's own password.
 *
 * An invite link signs the person in but leaves the account WITHOUT a password
 * — so without this step they could only ever get back in via a magic link.
 * /set-password is where the callback sends them, before they reach the app.
 */
export async function setPassword(
  _prev: AuthResult | null,
  formData: FormData
): Promise<AuthResult> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 8)
    return { ok: false, error: "Use at least 8 characters." };
  if (password !== confirm)
    return { ok: false, error: "The two passwords don't match." };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

/** Sign the current user out and return to the login page. */
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
