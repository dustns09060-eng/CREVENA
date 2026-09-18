import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Where Supabase sends the user after they click the email confirmation OR
// password-recovery link (see emailRedirectTo in login/page.tsx's signUp
// call, and resetPasswordForEmail's redirectTo in reset-password/page.tsx).
// Exchanges the PKCE code for a session so the user lands back in the app
// already signed in, instead of needing a manual confirmation step. `next`
// tells us where a successful exchange should land — signup confirmation
// omits it (defaults to /dashboard), password recovery sets it to
// /update-password so the user is sent to set a new password instead of
// straight into the app.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") === "/update-password" ? "/update-password" : "/dashboard";

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  if (next === "/update-password") {
    return NextResponse.redirect(`${origin}/reset-password?link_error=1`);
  }
  return NextResponse.redirect(`${origin}/login?confirm_error=1`);
}
