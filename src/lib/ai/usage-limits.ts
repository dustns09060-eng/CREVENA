import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getAiLimitsForPlan } from "./plan-limits";
import { UNLIMITED_RATE_LIMIT_PER_MINUTE, isUnlimitedUser } from "@/lib/entitlements";

export type UsageCheckResult =
  | { allowed: true; reservationId: string }
  | { allowed: false; reason: "RATE_LIMIT" | "QUOTA_EXCEEDED"; message: string };

export function currentPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Must be called (and must return allowed:true) before an AI provider is
// invoked, with the exact credit cost the caller is about to spend.
// Rate limit is a short-window approximate check (unchanged from STEP18,
// still call-count based — it's burst protection, not billing).
// The monthly credit budget is enforced atomically in the DB
// (increment_ai_credits) so concurrent requests can't collectively spend
// past the limit. On allowed:true, creditsNeeded has already been deducted
// and a reservation was recorded; if the AI call that follows fails, call
// refundAiCredits(supabase, reservationId) to give the credits back. A
// reservation can only ever be refunded once, and only by the user who
// owns it — see migration 0012.
export async function checkAndConsumeAiCredits(
  supabase: SupabaseClient<Database>,
  userId: string,
  planTier: string | null | undefined,
  creditsNeeded: number,
): Promise<UsageCheckResult> {
  const limits = getAiLimitsForPlan(planTier);
  // STEP48: unlimited owner accounts skip the monthly credit budget only.
  // The credit RPC below still records usage and a refundable reservation
  // (it re-reads the flag from the database itself, so nothing here can
  // grant it), and the burst rate limit stays on — see entitlements.ts.
  const unlimited = await isUnlimitedUser(supabase, userId);
  const rateLimitPerMinute = unlimited ? UNLIMITED_RATE_LIMIT_PER_MINUTE : limits.rateLimitPerMinute;

  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await supabase
    .from("ai_usage_logs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", since);

  if ((count ?? 0) >= rateLimitPerMinute) {
    return {
      allowed: false,
      reason: "RATE_LIMIT",
      message: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
    };
  }

  const { data, error } = await supabase.rpc("increment_ai_credits", {
    p_period: currentPeriod(),
    p_amount: creditsNeeded,
    p_limit: limits.monthlyCreditLimit,
  });

  if (error) {
    // Fail closed: if we can't verify the credit balance, don't call the
    // (paid) provider.
    return {
      allowed: false,
      reason: "QUOTA_EXCEEDED",
      message: "사용량을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.",
    };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.allowed || !row.reservation_id) {
    return {
      allowed: false,
      reason: "QUOTA_EXCEEDED",
      message: "이번 달 AI 크레딧을 모두 사용했습니다.",
    };
  }

  return { allowed: true, reservationId: row.reservation_id };
}

// Gives back the credits reserved under reservationId (from
// checkAndConsumeAiCredits) for a call that ended up failing. Best-effort:
// logs but never throws, since a refund failure shouldn't turn an
// already-failed AI call into a 500 that hides the real error from the
// user.
export async function refundAiCredits(
  supabase: SupabaseClient<Database>,
  reservationId: string,
): Promise<void> {
  const { error } = await supabase.rpc("refund_ai_credits", {
    p_reservation_id: reservationId,
  });
  if (error) {
    console.error("refundAiCredits failed:", error.message);
  }
}
