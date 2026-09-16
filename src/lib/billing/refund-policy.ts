// Configurable per STEP29: "신규 결제 직후 전액 환불 -> 해당 유료 권한 종료
// 가능 / 부분 환불 -> 플랜 유지". Only a brand-new (INITIAL) payment,
// refunded in full, ends paid access immediately. A full refund of a
// RECURRING charge does not by itself downgrade the account — that charge
// already covered a period the user had access to, and refunding it is a
// billing adjustment, not evidence the subscription should end.
export function shouldTerminateAccessOnRefund(input: {
  kind: "INITIAL" | "RECURRING";
  isFullRefund: boolean;
}): boolean {
  return input.kind === "INITIAL" && input.isFullRefund;
}
