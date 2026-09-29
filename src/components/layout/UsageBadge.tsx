import { getCachedAuthUser, getCachedUserStatus, getCachedUsageQuota } from "@/lib/user-context";
import { getAiLimitsForPlan } from "@/lib/ai/plan-limits";

// Read-only display of this month's AI usage. Never writes to ai_usage_quotas
// or affects the rate-limit/quota checks in checkAndConsumeAiCredits.
export async function UsageBadge() {
  const { user } = await getCachedAuthUser();
  if (!user) return null;

  const profile = await getCachedUserStatus(user.id);
  const limits = getAiLimitsForPlan(profile?.plan_tier);
  const quota = await getCachedUsageQuota(user.id);
  const used = quota?.used_count ?? 0;

  // STEP48: 운영자 무제한 accounts see their real usage with no cap, so the
  // badge can't be mistaken for a limit they might hit. Everyone else sees
  // exactly what they saw before.
  if (profile?.is_unlimited === true) {
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
