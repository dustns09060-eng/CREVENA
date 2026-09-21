import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAiLimitsForPlan } from "@/lib/ai/plan-limits";
import { currentPeriod } from "@/lib/ai/usage-limits";
import { isUnlimitedUser } from "@/lib/entitlements";

// Read-only display of this month's AI usage. Never writes to ai_usage_quotas
// or affects the rate-limit/quota checks in checkAndConsumeAiCredits.
export async function UsageBadge() {
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

  // STEP48: 운영자 무제한 accounts see their real usage with no cap, so the
  // badge can't be mistaken for a limit they might hit. Everyone else sees
  // exactly what they saw before.
  if (await isUnlimitedUser(supabase, user.id)) {
    return (
      <div className="px-3 py-2 text-xs text-zinc-500">
        이번 달 AI 사용량 {used} 크레딧 <span className="font-semibold text-emerald-600">· 운영자 무제한</span>
      </div>
    );
  }

  const nearLimit = used >= limits.monthlyCreditLimit * 0.9;

  return (
    <div className="px-3 py-2 text-xs text-zinc-500">
      <span className={nearLimit ? "font-semibold text-amber-600" : ""}>
        이번 달 AI 사용량 {used}/{limits.monthlyCreditLimit} 크레딧
      </span>
    </div>
  );
}
