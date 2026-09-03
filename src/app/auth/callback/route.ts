import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { createClient } from "@/core/supabase/server";

/**
 * OAuth / magic-link / email-confirmation callback.
 *
 * Handles two server-side (PKCE) flows, both of which establish the session via
 * cookies so it can't leak in a URL hash:
 *   - OAuth / code exchange: `?code=` -> exchangeCodeForSession.
 *   - Email links (invite, magic link, recovery, email change): the email
 *     template links here with `?token_hash=&type=` -> verifyOtp.
 *
 * IMPORTANT: the email templates must use {{ .TokenHash }}, not the default
 * {{ .ConfirmationURL }} (which returns the session as a `#access_token=` hash
 * the server cannot read — that produced the old "auth_callback" error).
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/dashboard";

  const supabase = await createClient();
  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && type
      ? await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
      : { error: new Error("Missing auth parameters") };

  if (!error) {
    const forwardedHost = request.headers.get("x-forwarded-host");
    const isLocal = process.env.NODE_ENV === "development";
    const safeNext = next.startsWith("/") ? next : "/dashboard";

    // An invite or recovery link signs the person in but leaves the account
    // with NO password of their own — they'd be stuck on magic links forever.
    // Send them to choose one before they reach the app.
    const dest =
      type === "invite" || type === "recovery" ? "/set-password" : safeNext;

    if (isLocal) return NextResponse.redirect(`${origin}${dest}`);
    if (forwardedHost)
      return NextResponse.redirect(`https://${forwardedHost}${dest}`);
    return NextResponse.redirect(`${origin}${dest}`);
  }

  return NextResponse.redirect(`${origin}/error?reason=auth_callback`);
}
