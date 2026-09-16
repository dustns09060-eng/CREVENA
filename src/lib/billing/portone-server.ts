import { PaymentClient } from "@portone/server-sdk";

// Server-only PortOne V2 client. PORTONE_API_SECRET never has a
// NEXT_PUBLIC_ prefix and is never read from client code.
export function getPortOnePaymentClient() {
  const secret = process.env.PORTONE_API_SECRET;
  if (!secret) {
    throw new Error("PORTONE_API_SECRET 환경변수가 설정되지 않았습니다.");
  }
  return PaymentClient({ secret });
}
