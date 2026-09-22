import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getPortOneBillingKeyClient } from "@/lib/billing/portone-server";

// The ONLY place a PortOne billing key is deleted.
//
// Why it exists: a billing key is a stored payment credential. Until this
// existed nothing ever deleted one, so every path that ended a subscription
// (period end after cancelling, three failed retries, a full refund of the
// first payment, a withdrawal) left a live key at PortOne — for a withdrawal,
// with no account row left to find it again.
//
// Rules, in order of importance:
//  1. The local key is cleared ONLY when the key is known to be gone at
//     PortOne (deleted now, or PortOne says it is already deleted / unknown).
//     On any other outcome it is kept: it is the only handle for a retry.
//  2. Failures are recorded as a short category in
//     users.billing_key_revoke_error (never the provider error, never the key)
//     so a later retry can find them.
//  3. It never throws: callers decide what a failure means for them (the
//     cron/refund paths carry on, a withdrawal stops).
//  4. Nothing here ever logs the key.
//  5. The clear is conditional on the key still being the one that was
//     deleted, so a member who registered a NEW card in the meantime keeps it.
//  6. Users without a key never reach PortOne: no key -> no client, no call.

export type RevokeOutcome = "REVOKED" | "NOTHING_TO_REVOKE" | "FAILED";

type ServiceClient = SupabaseClient<Database>;
export type BillingKeyDeleter = (billingKey: string) => Promise<void>;

// PortOne's own answers that mean "there is no usable key any more".
const GONE_TYPES = new Set(["BILLING_KEY_ALREADY_DELETED", "BILLING_KEY_NOT_FOUND", "BILLING_KEY_NOT_ISSUED"]);

function errorType(error: unknown): string | undefined {
  const type = (error as { data?: { type?: unknown } } | null | undefined)?.data?.type;
  return typeof type === "string" ? type : undefined;
}

export function isBillingKeyGone(error: unknown): boolean {
  const type = errorType(error);
  return type !== undefined && GONE_TYPES.has(type);
}

// A safe, short label for users.billing_key_revoke_error.
export function billingKeyRevokeErrorCategory(error: unknown): string {
  const type = errorType(error);
  if (type) return type.slice(0, 60);
  if (error instanceof Error && error.message.includes("PORTONE_API_SECRET")) return "MISSING_CONFIG";
  return "UNKNOWN";
}

const defaultDeleter: BillingKeyDeleter = async (billingKey) => {
  await getPortOneBillingKeyClient().deleteBillingKey({
    billingKey,
    reason: "구독 종료로 인한 빌링키 삭제",
    requester: "ADMIN",
  });
};

export async function revokeBillingKeyForUser(
  service: ServiceClient,
  userId: string,
  deleteKey: BillingKeyDeleter = defaultDeleter,
): Promise<RevokeOutcome> {
  const { data: row, error: readError } = await service
    .from("users")
    .select("payment_subscription_id")
    .eq("id", userId)
    .maybeSingle();

  if (readError) {
    console.error(`[billing-key] user=${userId.slice(0, 8)} step=read result=READ_FAILED`);
    return "FAILED";
  }
  const billingKey = row?.payment_subscription_id;
  if (!billingKey) return "NOTHING_TO_REVOKE";

  try {
    await deleteKey(billingKey);
  } catch (error) {
    if (!isBillingKeyGone(error)) {
      const category = billingKeyRevokeErrorCategory(error);
      console.error(`[billing-key] user=${userId.slice(0, 8)} step=delete result=${category}`);
      // Best effort: if the column does not exist yet this fails quietly and
      // the key simply stays for the next attempt.
      await service.from("users").update({ billing_key_revoke_error: category }).eq("id", userId);
      return "FAILED";
    }
    // Already gone at PortOne: fall through and clear the local copy.
  }

  const cleared = { payment_subscription_id: null, billing_key_revoked_at: new Date().toISOString(), billing_key_revoke_error: null };
  let { error: updateError } = await service
    .from("users")
    .update(cleared)
    .eq("id", userId)
    .eq("payment_subscription_id", billingKey);

  if (updateError) {
    // Most likely the two tracking columns are not there yet (migration 0031
    // not applied). The key IS deleted at PortOne, so at least drop the
    // local copy.
    ({ error: updateError } = await service
      .from("users")
      .update({ payment_subscription_id: null })
      .eq("id", userId)
      .eq("payment_subscription_id", billingKey));
  }
  if (updateError) {
    // Deleted remotely but not cleared locally. The next attempt gets
    // "already deleted" from PortOne, which counts as gone, and clears it.
    console.error(`[billing-key] user=${userId.slice(0, 8)} step=clear result=CLEAR_FAILED`);
    return "FAILED";
  }
  return "REVOKED";
}
