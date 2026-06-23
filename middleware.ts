import { type NextRequest } from "next/server";

import { updateSession } from "@/core/supabase/middleware";

/**
 * Edge middleware: keeps the Supabase auth session fresh on every request and
 * guards protected routes. The actual logic lives in core/supabase/middleware
 * so it stays testable and reusable.
 */
export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     *  - _next/static, _next/image (build assets)
     *  - favicon.ico and common image files
     * Tweak this list as the app grows.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
