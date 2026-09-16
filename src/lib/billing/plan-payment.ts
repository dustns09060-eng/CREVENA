"use client";

// Client-side orchestration for "카드 등록 → 빌링키 발급 → 첫 결제". This is
// the one place UpgradeButton talks to, so swapping the PG later only means
// editing this file. Actual money movement never happens here: this only
// gets a billingKey from PortOne/Toss's own auth UI, then hands it to
// /api/billing/confirm-payment, which is the only place that ever charges
// the card or changes plan_tier (see that route's comments).
export type UpgradeOutcome = { ok: true } | { ok: false; message: string };

export async function startPlanUpgrade(
  plan: "BASIC" | "PRO",
  userId: string,
): Promise<UpgradeOutcome> {
  const storeId = process.env.NEXT_PUBLIC_PORTONE_STORE_ID;
  const channelKey = process.env.NEXT_PUBLIC_PORTONE_CHANNEL_KEY;
  if (!storeId || !channelKey) {
    return { ok: false, message: "결제 설정이 아직 완료되지 않았습니다. 관리자에게 문의해주세요." };
  }

  const PortOne = await import("@portone/browser-sdk/v2");
  const paymentId = `payment-${crypto.randomUUID()}`;

  const issueResponse = await PortOne.requestIssueBillingKey({
    storeId,
    channelKey,
    billingKeyMethod: "CARD",
    issueId: paymentId,
    issueName: `CreatorFlow ${plan} 정기결제 카드 등록`,
    customer: { customerId: userId },
  });

  if (!issueResponse) {
    return { ok: false, message: "카드 등록 진행 상태를 확인할 수 없습니다. 새로고침 후 다시 시도해주세요." };
  }
  if (issueResponse.code !== undefined) {
    return { ok: false, message: issueResponse.message ?? "카드 등록에 실패했습니다." };
  }

  const res = await fetch("/api/billing/confirm-payment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan, billingKey: issueResponse.billingKey, paymentId }),
  });
  const data = await res.json();
  if (!res.ok) {
    return { ok: false, message: data.error ?? "결제 확인에 실패했습니다." };
  }
  return { ok: true };
}
