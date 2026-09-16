import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Where Supabase sends the user after they click the email confirmation
// link (see emailRedirectTo in login/page.tsx's signUp call). Exchanges the
// PKCE code for a session so the user lands back in the app already signed
// in, instead of needing a manual confirmation step.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}/dashboard`);
    }
  }

  return NextResponse.redirect(`${origin}/login?confirm_error=1`);
}
