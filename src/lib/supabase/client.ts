import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";
import { assertNotAccidentallyProduction } from "./production-guard";

export function createSupabaseBrowserClient() {
  assertNotAccidentallyProduction();
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
