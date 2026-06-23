import { redirect } from "next/navigation";

import { createClient } from "@/core/supabase/server";
import type { AppUser } from "@/core/auth/types";

/**
 * Returns the current authenticated user, or null. Use in Server Components
 * when a logged-out state is a valid outcome (e.g. the landing redirect).
 */
export async function getUser(): Promise<AppUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;
  return { id: user.id, email: user.email ?? null };
}

/**
 * Returns the current user or redirects to /login. Use at the top of any
 * protected Server Component / layout to guarantee an authenticated user.
 */
export async function requireUser(): Promise<AppUser> {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}
