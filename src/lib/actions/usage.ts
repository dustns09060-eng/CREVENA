"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAiLimitsForPlan } from "@/lib/ai/plan-limits";
import { currentPeriod } from "@/lib/ai/usage-limits";
import { isUnlimitedUser } from "@/lib/entitlements";

// STEP36 item 5: server-authoritative remaining-credit read for the one-click
// pipeline's pre-flight check. Never trusts the client's own estimate —
// actual charging still happens exclusively through checkAndConsumeAiCredits
// per AI call; this is read-only and only used to warn the user before they
// start a run that would likely run out of credits partway through.
export async function getRemainingCredits(): Promise<{
  used: number;
  limit: number;
  remaining: number;
  // STEP48: true for 운영자 무제한 accounts. limit/remaining are then only
  // "large enough that no pre-flight warning ever fires" — real usage is still
  // counted in `used`.
  unlimited: boolean;
} | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("users")
    .select("plan_tier")
    .eq("id", user.id)
    .maybeSingle();

  const limits = getAiLimitsForPlan(profile?.plan_tier);

  const { data: quota } = await supabase
    .from("ai_usage_quotas")
    .select("used_count")
    .eq("user_id", user.id)
    .eq("period", currentPeriod())
    .maybeSingle();

  const used = quota?.used_count ?? 0;
  if (await isUnlimitedUser(supabase, user.id)) {
    return { used, limit: Number.MAX_SAFE_INTEGER, remaining: Number.MAX_SAFE_INTEGER, unlimited: true };
  }
  return {
    used,
    limit: limits.monthlyCreditLimit,
    remaining: Math.max(0, limits.monthlyCreditLimit - used),
    unlimited: false,
  };
}
