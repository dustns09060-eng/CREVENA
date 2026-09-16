// AI-specific view of the plan config. The actual numbers live in
// src/lib/plans.ts (the single source of truth shared with /pricing) —
// this file just re-exposes the subset usage-limits.ts/UsageBadge/admin
// pages need, under the names they already import.
import { PLAN_CONFIGS, normalizePlanTier, type PlanTier } from "@/lib/plans";

export type { PlanTier };
export { normalizePlanTier };

export type AiPlanLimits = {
  rateLimitPerMinute: number;
  // Monthly budget in AI credits (see src/lib/ai/credits.ts), not call count.
  monthlyCreditLimit: number;
};

export function getAiLimitsForPlan(raw: string | null | undefined): AiPlanLimits {
  const config = PLAN_CONFIGS[normalizePlanTier(raw)];
  return { rateLimitPerMinute: config.rateLimitPerMinute, monthlyCreditLimit: config.monthlyCreditLimit };
}
