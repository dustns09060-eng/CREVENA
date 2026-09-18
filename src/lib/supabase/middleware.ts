import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";

// STEP43: "/" becomes a real public marketing landing page instead of an
// unconditional redirect-to-dashboard, so logged-out visitors can actually
// see it. Adding it here follows the exact same pattern already used for
// /login — this is not new authorization logic, just widening which paths
// don't require a session, and the existing `user && isPublicPath` rule
// below still sends an already-logged-in visitor straight to /dashboard.
const PUBLIC_PATHS = ["/login", "/"];

export async function updateSession(request: NextRequest) {
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

  if (isApiPath || isAuthCallbackPath) {
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
