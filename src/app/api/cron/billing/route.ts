import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getPortOnePaymentClient } from "@/lib/billing/portone-server";
import { PLAN_CONFIGS, normalizePlanTier } from "@/lib/plans";
import { getNextRetryDelayDays } from "@/lib/billing/retry-policy";

const BATCH_SIZE = 50;

function addOneMonth(date: Date) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + 1);
  return next;
}

// Never store the raw provider error object (it can echo request fields);
// only pull out the safe type/code discriminant PortOne's SDK exposes.
function extractPaymentError(error: unknown): { code: string; type: string } {
  const data = (error as { data?: { type?: unknown; pgCode?: unknown } } | null | undefined)?.data;
  const type = typeof data?.type === "string" ? data.type : "UNKNOWN";
  const code = typeof data?.pgCode === "string" ? data.pgCode : type;
  return { code, type };
}

// Server-only recurring billing job, meant to be hit by a scheduler (Vercel
// Cron) on a fixed interval. Nothing here ever reads plan/amount from a
// request body — there isn't one; the only inputs are DB rows this server
// already trusts (plan_tier) and plans.ts (price). See CLAUDE-facing notes
// in supabase/migrations/0015_recurring_billing.sql for the concurrency/
// idempotency design (claim_billing_attempt).
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const service = createSupabaseServiceClient();
  const nowIso = new Date().toISOString();

  const { data: due, error: dueError } = await service
    .from("users")
    .select(
      "id, plan_tier, subscription_status, next_billing_at, next_retry_at, retry_count, payment_subscription_id, cancel_at_period_end, scheduled_plan",
    )
    .in("plan_tier", ["BASIC", "PRO"])
    .or(
      `and(cancel_at_period_end.eq.false,subscription_status.eq.ACTIVE,next_billing_at.lte.${nowIso}),and(cancel_at_period_end.eq.false,subscription_status.eq.PAST_DUE,next_retry_at.lte.${nowIso}),and(cancel_at_period_end.eq.true,next_billing_at.lte.${nowIso})`,
    )
    .limit(BATCH_SIZE);

  if (dueError) {
    return NextResponse.json({ error: "청구 대상 조회 실패" }, { status: 500 });
  }

  const results: { userId: string; outcome: string }[] = [];

  for (const sub of due ?? []) {
    // A cancelled subscription reaching its period end: no charge, just
    // drop to FREE. Nothing here touches collaborations/contents/etc.
    if (sub.cancel_at_period_end) {
      await service
        .from("users")
        .update({
          plan_tier: "FREE",
          subscription_status: "NONE",
          scheduled_plan: null,
          cancel_at_period_end: false,
          next_billing_at: null,
          next_retry_at: null,
          retry_count: 0,
          last_payment_failed_at: null,
          last_payment_error_type: null,
          subscription_expires_at: null,
        })
        .eq("id", sub.id);
      results.push({ userId: sub.id, outcome: "CANCELED_TO_FREE" });
      continue;
    }

    // A pending downgrade (PRO -> BASIC) takes effect exactly at the next
    // successful charge: the charge itself is for the NEW plan's price, and
    // plan_tier only switches once that charge is verified below.
    const plan = normalizePlanTier(sub.scheduled_plan ?? sub.plan_tier);
    // Defensive only — the query above already excludes FREE, and
    // scheduled_plan is never set to FREE without cancel_at_period_end.
    if (plan === "FREE" || !sub.payment_subscription_id || !sub.next_billing_at) continue;

    const amount = PLAN_CONFIGS[plan].monthlyPriceKrw;
    // The anchor for this billing cycle. It only ever moves forward on a
    // successful charge (below), so it stays identical across every retry
    // of the same cycle — that stability is what the unique index in
    // claim_billing_attempt relies on to block double-charging the cycle.
    const billingPeriodStart = sub.next_billing_at;
    const paymentId = `recurring-${crypto.randomUUID()}`;

    const { data: claimed, error: claimError } = await service.rpc("claim_billing_attempt", {
      p_user_id: sub.id,
      p_billing_period_start: billingPeriodStart,
      p_plan: plan,
      p_amount: amount,
      p_payment_id: paymentId,
    });

    if (claimError || !claimed || claimed.length === 0) {
      results.push({ userId: sub.id, outcome: "SKIPPED_ALREADY_CLAIMED" });
      continue;
    }
    const claimedPaymentId = claimed[0].payment_id;

    async function markFailed(errorCode: string, errorType: string) {
      const nextRetryCount = sub.retry_count + 1;
      const delayDays = getNextRetryDelayDays(nextRetryCount);
      const failedAt = new Date().toISOString();

      await service
        .from("payment_events")
        .update({ status: "FAILED", error_code: errorCode, error_type: errorType })
        .eq("payment_id", claimedPaymentId);

      if (delayDays === null) {
        // Retries exhausted: expire the subscription and fall back to
        // FREE. Nothing here deletes collaborations/contents/etc — only
        // subscription/plan fields on users are touched.
        await service
          .from("users")
          .update({
            plan_tier: "FREE",
            subscription_status: "EXPIRED",
            scheduled_plan: null,
            retry_count: nextRetryCount,
            next_retry_at: null,
            next_billing_at: null,
            last_payment_failed_at: failedAt,
            last_payment_error_type: errorType,
          })
          .eq("id", sub.id);
        results.push({ userId: sub.id, outcome: "EXPIRED" });
      } else {
        const nextRetryAt = new Date(Date.now() + delayDays * 24 * 60 * 60 * 1000);
        await service
          .from("users")
          .update({
            subscription_status: "PAST_DUE",
            retry_count: nextRetryCount,
            next_retry_at: nextRetryAt.toISOString(),
            last_payment_failed_at: failedAt,
            last_payment_error_type: errorType,
          })
          .eq("id", sub.id);
        results.push({ userId: sub.id, outcome: "FAILED_WILL_RETRY" });
      }
    }

    try {
      const paymentClient = getPortOnePaymentClient();
      await paymentClient.payWithBillingKey({
        paymentId: claimedPaymentId,
        billingKey: sub.payment_subscription_id,
        orderName: `CreatorFlow ${plan} 정기결제`,
        amount: { total: amount },
        currency: "KRW",
        customer: { id: sub.id },
      });

      // Same rule as the initial payment: never trust the synchronous
      // charge response alone, independently re-fetch by id first.
      const verified = await paymentClient.getPayment({ paymentId: claimedPaymentId });
      if (verified.status !== "PAID" || verified.amount.total !== amount) {
        await markFailed("VERIFY_MISMATCH", "VERIFY_MISMATCH");
        continue;
      }

      await service.from("payment_events").update({ status: "PAID" }).eq("payment_id", claimedPaymentId);

      // Advance from the fixed cycle anchor, not from "now" — otherwise a
      // cron that runs late (or a retried cycle) would keep pushing the
      // billing date back instead of the account being cycled on schedule.
      const nextBillingAt = addOneMonth(new Date(billingPeriodStart));
      await service
        .from("users")
        .update({
          plan_tier: plan,
          scheduled_plan: null,
          subscription_status: "ACTIVE",
          retry_count: 0,
          next_retry_at: null,
          last_payment_failed_at: null,
          last_payment_error_type: null,
          next_billing_at: nextBillingAt.toISOString(),
          subscription_expires_at: null,
        })
        .eq("id", sub.id);
      results.push({ userId: sub.id, outcome: "PAID" });
    } catch (error) {
      const { code, type } = extractPaymentError(error);
      await markFailed(code, type);
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
