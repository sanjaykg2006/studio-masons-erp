import { NextResponse } from "next/server";

import { createClient } from "@/core/supabase/server";

/**
 * OAuth / magic-link / email-confirmation callback.
 *
 * Supabase redirects here with a `code` (PKCE) which we exchange for a session.
 * Handles email confirmations, magic links, and future OAuth providers
 * (e.g. Microsoft Entra ID) without changes.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const forwardedHost = request.headers.get("x-forwarded-host");
      const isLocal = process.env.NODE_ENV === "development";
      const safeNext = next.startsWith("/") ? next : "/dashboard";

      if (isLocal) return NextResponse.redirect(`${origin}${safeNext}`);
      if (forwardedHost)
        return NextResponse.redirect(`https://${forwardedHost}${safeNext}`);
      return NextResponse.redirect(`${origin}${safeNext}`);
    }
  }

  return NextResponse.redirect(`${origin}/error?reason=auth_callback`);
}
