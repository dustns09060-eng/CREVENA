import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getPortOnePaymentClient } from "@/lib/billing/portone-server";
import { PLAN_CONFIGS, normalizePlanTier } from "@/lib/plans";

const PAYABLE_PLANS = ["BASIC", "PRO"] as const;
type PayablePlan = (typeof PAYABLE_PLANS)[number];

function isPayablePlan(value: unknown): value is PayablePlan {
  return typeof value === "string" && (PAYABLE_PLANS as readonly string[]).includes(value);
}

function addOneMonth(date: Date) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + 1);
  return next;
}

// This is the ONLY place a payment result can turn into a plan change.
// Nothing here trusts the client: the plan name selects a price from
// plans.ts (never a client-sent amount), and "did the payment succeed" is
// answered exclusively by calling PortOne's own API with our server secret
// — never by a boolean the browser hands us. See src/lib/supabase/service.ts
// for why plan_tier writes happen through the service-role client here
// instead of the normal per-request Supabase client.
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const plan = body?.plan;
  const billingKey = body?.billingKey;
  const paymentId = body?.paymentId;

  if (!isPayablePlan(plan)) {
    return NextResponse.json({ error: "결제 가능한 플랜이 아닙니다." }, { status: 400 });
  }
  if (typeof billingKey !== "string" || !billingKey) {
    return NextResponse.json({ error: "billingKey는 필수입니다." }, { status: 400 });
  }
  if (typeof paymentId !== "string" || !paymentId) {
    return NextResponse.json({ error: "paymentId는 필수입니다." }, { status: 400 });
  }

  // The only source of truth for price. Any amount/plan field the client
  // might also send in the body is never read.
  const amount = PLAN_CONFIGS[plan].monthlyPriceKrw;
  const service = createSupabaseServiceClient();

  // Idempotency guard: the unique constraint on payment_id means only one
  // request can ever win this insert for a given paymentId. A duplicate
  // submission (double-click, retry, or someone replaying this call)
  // reaches the branch below instead of charging the card again.
  const { error: insertError } = await service.from("payment_events").insert({
    user_id: user.id,
    payment_id: paymentId,
    plan,
    amount,
    status: "PENDING",
  });

  if (insertError) {
    const { data: existing } = await service
      .from("payment_events")
      .select("status, user_id")
      .eq("payment_id", paymentId)
      .maybeSingle();

    if (existing?.user_id !== user.id) {
      // Never reveal another user's payment state.
      return NextResponse.json({ error: "이미 처리된 결제입니다." }, { status: 409 });
    }
    if (existing.status === "PAID") {
      return NextResponse.json({ ok: true, alreadyProcessed: true });
    }
    if (existing.status === "FAILED") {
      return NextResponse.json(
        { error: "이미 실패로 처리된 결제입니다. 다시 시도해주세요." },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "이 결제는 처리 중입니다. 잠시 후 다시 시도해주세요." },
      { status: 409 },
    );
  }

  async function markFailed(reason: string, raw?: unknown) {
    await service
      .from("payment_events")
      .update({ status: "FAILED", raw_response: raw ? JSON.parse(JSON.stringify(raw)) : null })
      .eq("payment_id", paymentId);
    return NextResponse.json({ error: reason }, { status: 402 });
  }

  try {
    const paymentClient = getPortOnePaymentClient();

    const chargeResult = await paymentClient.payWithBillingKey({
      paymentId,
      billingKey,
      orderName: `CREVENA ${plan} 구독`,
      amount: { total: amount },
      currency: "KRW",
      customer: { id: user.id },
    });

    // Never trust the synchronous charge response alone — independently
    // re-fetch the payment by id using our own secret before touching the
    // user's plan.
    const verified = await paymentClient.getPayment({ paymentId });

    if (verified.status !== "PAID" || verified.amount.total !== amount) {
      return await markFailed("결제 검증에 실패했습니다.", { chargeResult, verified });
    }

    await service
      .from("payment_events")
      .update({ status: "PAID", raw_response: JSON.parse(JSON.stringify(verified)) })
      .eq("payment_id", paymentId);

    const now = new Date();
    const { error: applyError } = await service
      .from("users")
      .update({
        plan_tier: normalizePlanTier(plan),
        subscription_status: "ACTIVE",
        subscription_started_at: now.toISOString(),
        subscription_expires_at: null,
        next_billing_at: addOneMonth(now).toISOString(),
        cancel_at_period_end: false,
        payment_provider: "PORTONE_TOSSPAYMENTS",
        payment_customer_id: user.id,
        payment_subscription_id: billingKey,
      })
      .eq("id", user.id);

    if (applyError) {
      return NextResponse.json(
        { error: "결제는 완료되었으나 구독 반영 중 오류가 발생했습니다. 관리자에게 문의해주세요." },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "결제에 실패했습니다.";
    return await markFailed(message, error instanceof Error ? { message: error.message } : error);
  }
}
