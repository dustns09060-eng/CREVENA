import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// The only place that decides "is this request an admin". Every /admin page
// (via the admin layout) calls this before rendering anything. It re-reads
// role from the DB on every request — never trusts a client-sent value or a
// cached claim — so a user cannot spoof admin access by editing local state.
export async function requireAdmin() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.role !== "ADMIN") {
    notFound();
  }

  return { supabase, userId: user.id, email: user.email ?? "" };
}
