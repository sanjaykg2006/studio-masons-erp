import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/core/config/env";

/**
 * Route groups that require an authenticated user. Anything else is public.
 * Auth routes (/login, /auth/*) are intentionally excluded.
 */
const PROTECTED_PREFIXES = ["/dashboard", "/access"];

const isProtected = (pathname: string) =>
  PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );

/**
 * Runs on every matched request (see middleware.ts):
 *  1. Refreshes the Supabase auth session and syncs cookies onto the response.
 *  2. Redirects unauthenticated users away from protected routes to /login.
 *
 * IMPORTANT: always return the `supabaseResponse` object so refreshed auth
 * cookies are propagated to the browser.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Do not run code between createServerClient and getUser() — it must be the
  // first call so the session refresh happens reliably.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && isProtected(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirectTo", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
