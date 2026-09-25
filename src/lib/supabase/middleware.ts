import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";
import { assertNotAccidentallyProduction } from "./production-guard";

// STEP43: "/" becomes a real public marketing landing page instead of an
// unconditional redirect-to-dashboard, so logged-out visitors can actually
// see it. Adding it here follows the exact same pattern already used for
// /login — this is not new authorization logic, just widening which paths
// don't require a session, and the existing `user && isPublicPath` rule
// below still sends an already-logged-in visitor straight to /dashboard.
// STEP43-1: /reset-password (request a recovery email) and /find-id (static,
// no-lookup guidance page) must be reachable by logged-out visitors, same
// reasoning as /login. /update-password is intentionally NOT public — it
// requires the session that Supabase's recovery-link code exchange creates
// (see /auth/callback/route.ts), so the existing `!user && !isPublicPath`
// rule below correctly gates it like any other authenticated page.
const PUBLIC_PATHS = ["/login", "/", "/reset-password", "/find-id"];

// STEP45: the policy/info pages. These differ from PUBLIC_PATHS above in one
// important way — PUBLIC_PATHS are *logged-out* destinations, so an
// authenticated visitor gets bounced off them to /dashboard (correct for
// /login and the marketing landing page). The terms/privacy/refund pages must
// stay readable by everyone, signed in or not: a paying user needs to be able
// to open 환불정책 from the footer without being thrown to the dashboard.
// So these are checked first and simply pass through, for any auth state.
// This is routing configuration only — no change to how sessions or
// authorization are evaluated.
const OPEN_PATHS = ["/terms", "/privacy", "/refund-policy", "/contact"];

export async function updateSession(request: NextRequest) {
  assertNotAccidentallyProduction();
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublicPath = PUBLIC_PATHS.includes(request.nextUrl.pathname);
  const isApiPath = request.nextUrl.pathname.startsWith("/api/");
  // /auth/callback exchanges the email-confirmation code for a session, so
  // it must be reachable before a session exists.
  const isAuthCallbackPath = request.nextUrl.pathname.startsWith("/auth/");

  const isOpenPath = OPEN_PATHS.includes(request.nextUrl.pathname);

  if (isApiPath || isAuthCallbackPath || isOpenPath) {
    return response;
  }

  if (!user && !isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return response;
}
