import { BillingKeyClient, PaymentClient } from "@portone/server-sdk";

// Server-only PortOne V2 clients. PORTONE_API_SECRET never has a
// NEXT_PUBLIC_ prefix and is never read from client code.
function requireSecret() {
  const secret = process.env.PORTONE_API_SECRET;
  if (!secret) {
    throw new Error("PORTONE_API_SECRET 환경변수가 설정되지 않았습니다.");
  }
  return secret;
}

export function getPortOnePaymentClient() {
  return PaymentClient({ secret: requireSecret() });
}

// Billing-key management (deleting a key). Kept separate from the payment
// client because it is a different SDK client; nothing else in the app
// creates one — see src/lib/billing/revoke-billing-key.ts.
export function getPortOneBillingKeyClient() {
  return BillingKeyClient({ secret: requireSecret() });
}
