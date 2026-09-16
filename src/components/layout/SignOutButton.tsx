"use client";

import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      onClick={handleSignOut}
      className="shrink-0 rounded-lg px-3 py-2 text-left text-sm font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
    >
      로그아웃
    </button>
  );
}
