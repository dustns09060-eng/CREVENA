import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { currentPeriod } from "@/lib/ai/usage-limits";

// Dedupe the handful of "who's logged in / what's their status" reads that
// multiple independent server components (UsageBadge in both the mobile
// header and the desktop sidebar, PaymentStatusBanner) each used to run on
// their own. React's cache() memoizes by argument for the lifetime of a
// single request/render pass, so calling these from several components in
// the same page load now hits the network once instead of once per caller.
// Never used to skip an auth check — every caller still gets a real
// (session-scoped) user or null, exactly as before.

export const getCachedAuthUser = cache(async () => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
});

// Combines what UsageBadge (plan_tier, is_unlimited) and PaymentStatusBanner
// (subscription_status, next_retry_at) each queried separately into one row
// fetch. Same columns, same RLS (own row only), just fewer round trips.
export const getCachedUserStatus = cache(async (userId: string) => {
  const { supabase } = await getCachedAuthUser();
  const { data } = await supabase
    .from("users")
    .select("plan_tier, is_unlimited, subscription_status, next_retry_at")
    .eq("id", userId)
    .maybeSingle();
  return data;
});

export const getCachedUsageQuota = cache(async (userId: string) => {
  const { supabase } = await getCachedAuthUser();
  const { data } = await supabase
    .from("ai_usage_quotas")
    .select("used_count")
    .eq("user_id", userId)
    .eq("period", currentPeriod())
    .maybeSingle();
  return data;
});
