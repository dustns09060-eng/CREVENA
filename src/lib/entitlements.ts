import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { PLAN_CONFIGS } from "@/lib/plans";

// STEP48: "운영자 무제한" entitlement.
//
// public.users.is_unlimited (migration 0027) is the ONLY source of truth. No
// email address, role, plan or client-sent value ever grants it: the flag can
// only be set from the SQL editor / service role (signed-in users have no
// UPDATE privilege on it), and the credit RPC re-reads it from the database
// itself by auth.uid().
//
// Unlimited means: skip CREVENA's own internal caps (monthly credit budget,
// collaboration/content save limits). It does NOT touch plan_tier,
// subscriptions or payments, never disables usage logging, and cannot lift
// the Anthropic account balance, Supabase infrastructure quotas or any
// external API limit.
//
// It is intentionally a separate concept from role='ADMIN' (who may open
// /admin): an admin is not automatically unlimited and vice versa.

/**
 * Whether this user has the unlimited entitlement.
 *
 * Fails CLOSED: any error (including "column does not exist" while migration
 * 0027 isn't applied yet), a missing row or a non-`true` value means "not
 * unlimited", i.e. normal plan limits apply. It is read in its own query,
 * never bundled with plan_tier, so an unapplied migration can never break
 * plan detection for regular users.
 */
export async function isUnlimitedUser(supabase: SupabaseClient<Database>, userId: string): Promise<boolean> {
  const { data, error } = await supabase.from("users").select("is_unlimited").eq("id", userId).maybeSingle();
  if (error) return false;
  return data?.is_unlimited === true;
}

/**
 * Unlimited accounts still get burst protection: the rate limit exists to
 * stop a runaway loop from spending real provider money, which "unlimited
 * credits" must not turn off. They use the highest per-minute limit any plan
 * has, so a 50-photo analysis batch is never throttled.
 */
export const UNLIMITED_RATE_LIMIT_PER_MINUTE = Math.max(
  ...Object.values(PLAN_CONFIGS).map((config) => config.rateLimitPerMinute),
);
