import { NextResponse } from "next/server";

// Placeholder for a future payment provider's subscription webhook
// (Stripe/Toss/아임포트/...). STEP26 only prepares the DB structure and the
// admin-gated write path (see the admin_apply_subscription RPC in
// supabase/migrations/0013_subscription_lifecycle.sql) — actual webhook
// receipt is explicitly out of scope for this step.
//
// When a provider is chosen, this handler must, in order:
//   1. Read the raw request body and verify it against the provider's
//      webhook signature/secret BEFORE trusting anything in the payload.
//      Never update the DB based on an unverified request.
//   2. Map the verified event to a plan/subscription_status change.
//   3. Write it using a Supabase client created with the server-only
//      SUPABASE_SERVICE_ROLE_KEY env var (never sent to the browser) —
//      service_role bypasses the RLS/column-grant lockdown that correctly
//      blocks every other caller (including the app's own normal
//      user-session client) from touching plan_tier/subscription_status.
//      A webhook has no logged-in user session to authenticate as, which is
//      why it can't go through admin_apply_subscription's is_admin() check
//      like an admin-initiated change would.
export async function POST() {
  return NextResponse.json(
    { error: "결제 웹훅이 아직 연동되지 않았습니다." },
    { status: 501 },
  );
}
