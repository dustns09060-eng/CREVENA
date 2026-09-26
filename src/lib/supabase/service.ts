import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { assertNotAccidentallyProduction } from "./production-guard";

// SERVER-ONLY. Never import this from a "use client" file, and never send
// SUPABASE_SERVICE_ROLE_KEY to the browser — it bypasses RLS and the
// column-grant lockdown on public.users entirely (STEP19/23/26 all rely on
// that lockdown to stop users from writing their own plan_tier/role/
// subscription fields).
//
// Only call this after independently verifying a real event server-side
// (e.g. a PortOne payment confirmed via PaymentClient.getPayment using our
// own secret key) — never based on a client-supplied "it succeeded" claim.
// As of STEP27 the only caller is src/app/api/billing/confirm-payment.
export function createSupabaseServiceClient() {
  assertNotAccidentallyProduction();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY 환경변수가 설정되지 않았습니다.");
  }
  return createClient<Database>(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
