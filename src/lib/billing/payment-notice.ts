// What the in-app payment banner says for a given subscription state.
//
// This is the ONLY way a member is told about a failed recurring charge: the
// app has no e-mail/notification sender for it (the privacy policy therefore
// says "서비스 내 결제 상태 안내", not an e-mail). The state comes from
// users.subscription_status, which the billing cron maintains:
//   PAST_DUE  a charge failed and retries are still scheduled (the member
//             keeps their plan meanwhile)
//   EXPIRED   every retry failed and the account was moved to FREE
// Every other status shows nothing.
export type PaymentNotice = {
  tone: "warning" | "danger";
  title: string;
  body: string;
};

function formatRetryDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric" });
}

export function paymentNoticeFor(
  status: string | null | undefined,
  nextRetryAt: string | null | undefined,
): PaymentNotice | null {
  if (status === "PAST_DUE") {
    const retry = formatRetryDate(nextRetryAt);
    return {
      tone: "warning",
      title: "정기결제가 실패했어요",
      body: `등록한 카드로 결제하지 못했어요. 재시도가 예정되어 있으며${retry ? ` 다음 재시도는 ${retry}입니다` : ""}, 그동안 현재 요금제는 계속 이용할 수 있어요. 카드 정보를 확인해 주세요.`,
    };
  }
  if (status === "EXPIRED") {
    return {
      tone: "danger",
      title: "정기결제 실패로 FREE 요금제로 전환됐어요",
      body: "정기결제가 계속 실패해 요금제가 FREE로 바뀌었어요. 저장한 협찬과 콘텐츠는 그대로 있어요. 다시 유료 요금제를 이용하려면 결제 설정에서 카드를 등록해 주세요.",
    };
  }
  return null;
}
