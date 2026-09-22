import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getPortOnePaymentClient } from "@/lib/billing/portone-server";
import { shouldTerminateAccessOnRefund } from "@/lib/billing/refund-policy";
import { revokeBillingKeyForUser } from "@/lib/billing/revoke-billing-key";

function extractPaymentError(error: unknown): string {
  const data = (error as { data?: { type?: unknown } } | null | undefined)?.data;
  return typeof data?.type === "string" ? data.type : "UNKNOWN";
}

// Admin-only. The client sends a target amount, but it is never trusted at
// face value — the actual refundable ceiling (original amount minus prior
// SUCCEEDED refunds) is recomputed here from payment_events/payment_refunds
// before ever calling PortOne, so a manipulated amount can at most be
// rejected, never allowed to over-refund.
//
// Handles two cases with the SAME core logic (amount validation, idempotency,
// PortOne cancel, refund-row bookkeeping): a normal member's payment
// (paymentEvent.user_id present) and a withdrawn member's preserved payment
// (paymentEvent.user_id is NULL since migration 0024). They diverge only
// after a successful refund — a withdrawn member has no account row left,
// so nothing plan/subscription/credit/billing-key-related ever runs for
// them (see the `if (paymentUserId)` guard below). The admin screen that
// finds withdrawn-member payments to refund is
// admin_list_orphaned_refundable_payments() (migration 0032).
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { data: adminProfile } = await supabase.from("users").select("role").eq("id", user.id).maybeSingle();
  if (adminProfile?.role !== "ADMIN") {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const paymentEventId = body?.paymentEventId;
  const requestedAmount = body?.amount;
  const reason = typeof body?.reason === "string" ? body.reason.slice(0, 500) : "";
  const idempotencyKey = body?.idempotencyKey;

  if (typeof paymentEventId !== "string" || !paymentEventId) {
    return NextResponse.json({ error: "paymentEventId가 필요합니다." }, { status: 400 });
  }
  if (typeof idempotencyKey !== "string" || !idempotencyKey) {
    return NextResponse.json({ error: "idempotencyKey가 필요합니다." }, { status: 400 });
  }
  if (typeof requestedAmount !== "number" || !Number.isInteger(requestedAmount) || requestedAmount <= 0) {
    return NextResponse.json({ error: "환불 금액이 올바르지 않습니다." }, { status: 400 });
  }

  const service = createSupabaseServiceClient();

  const { data: paymentEvent } = await service
    .from("payment_events")
    .select("id, user_id, payment_id, amount, status, kind")
    .eq("id", paymentEventId)
    .maybeSingle();

  if (!paymentEvent || paymentEvent.status !== "PAID") {
    return NextResponse.json({ error: "환불 가능한 결제가 아닙니다." }, { status: 400 });
  }

  // STEP45.2 / STEP51: since migration 0024, payment_events.user_id is SET
  // NULL on account deletion — the transaction record is retained but no
  // longer points at an account. paymentUserId being null is NOT an error:
  // it means "refund a withdrawn member's preserved payment", a real,
  // narrower path (see admin_list_orphaned_refundable_payments in migration
  // 0032, which is how the admin screen finds these rows in the first
  // place). Every write below that touches a users row, a plan, credits, or
  // a billing key is gated on `if (paymentUserId)` further down — a
  // withdrawn member has no account row left for any of that to apply to.
  const paymentUserId = paymentEvent.user_id;

  const { data: priorRefunds } = await service
    .from("payment_refunds")
    .select("refund_amount")
    .eq("payment_event_id", paymentEventId)
    .eq("status", "SUCCEEDED");
  const alreadyRefunded = (priorRefunds ?? []).reduce((sum, r) => sum + r.refund_amount, 0);
  const remaining = paymentEvent.amount - alreadyRefunded;

  if (requestedAmount > remaining) {
    return NextResponse.json(
      { error: `환불 가능 금액(₩${remaining.toLocaleString()})을 초과했습니다.` },
      { status: 400 },
    );
  }

  // Idempotency guard: PENDING-insert-first on the unique idempotency_key —
  // the same pattern as payment_events.payment_id (STEP27). A double-click
  // or a retried request with the same key lands on the existing row
  // instead of calling PortOne's cancel API a second time.
  const { error: insertError } = await service.from("payment_refunds").insert({
    payment_event_id: paymentEventId,
    // NULL for a withdrawn member's payment (paymentUserId already carries
    // whatever payment_events.user_id held) — the column has allowed NULL
    // since migration 0024, and requested_by (the acting admin) always
    // identifies who ran this regardless.
    user_id: paymentUserId,
    refund_amount: requestedAmount,
    reason,
    status: "PENDING",
    requested_by: user.id,
    idempotency_key: idempotencyKey,
  });

  if (insertError) {
    const { data: existing } = await service
      .from("payment_refunds")
      .select("status")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existing?.status === "SUCCEEDED") {
      return NextResponse.json({ ok: true, alreadyProcessed: true });
    }
    if (existing?.status === "FAILED") {
      return NextResponse.json({ error: "이미 실패로 처리된 환불입니다. 다시 시도해주세요." }, { status: 409 });
    }
    return NextResponse.json({ error: "이 환불은 처리 중입니다." }, { status: 409 });
  }

  try {
    const paymentClient = getPortOnePaymentClient();
    const result = await paymentClient.cancelPayment({
      paymentId: paymentEvent.payment_id,
      amount: requestedAmount,
      reason: reason || "관리자 환불",
    });

    if (result.cancellation.status !== "SUCCEEDED") {
      await service
        .from("payment_refunds")
        .update({ status: "FAILED", processed_at: new Date().toISOString() })
        .eq("idempotency_key", idempotencyKey);
      return NextResponse.json({ error: "환불 처리에 실패했습니다." }, { status: 502 });
    }

    await service
      .from("payment_refunds")
      .update({
        status: "SUCCEEDED",
        provider_refund_id: result.cancellation.id,
        processed_at: new Date().toISOString(),
      })
      .eq("idempotency_key", idempotencyKey);

    // STEP51: a withdrawn member (paymentUserId === null) has no account
    // row left — no plan_tier to change, no subscription_status to set, no
    // billing key to revoke, no credits to touch. None of that runs for
    // them; the refund above is the entire effect. Only an active member
    // reaches this block, completely unchanged from before this PR.
    if (paymentUserId) {
      const isFullRefund = alreadyRefunded + requestedAmount >= paymentEvent.amount;
      if (shouldTerminateAccessOnRefund({ kind: paymentEvent.kind, isFullRefund })) {
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
          })
          .eq("id", paymentUserId);
        // Access ended, so the card token must not outlive it. A failure is
        // recorded on the user row and retried by the billing cron; it does not
        // change the refund result.
        await revokeBillingKeyForUser(service, paymentUserId);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    await service
      .from("payment_refunds")
      .update({ status: "FAILED", processed_at: new Date().toISOString() })
      .eq("idempotency_key", idempotencyKey);
    return NextResponse.json({ error: `환불에 실패했습니다 (${extractPaymentError(error)})` }, { status: 502 });
  }
}
