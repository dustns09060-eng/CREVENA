import type { Json } from "@/types/database";

// What payment_events.raw_response is allowed to hold.
//
// It used to be the full PortOne `Payment` object, verbatim. Nothing in the
// app ever reads it back, but it contained: `billingKey` (a live payment
// credential), `customer.id` (the Supabase user UUID — which defeats
// migration 0024's "user link removed on withdrawal"), `pgResponse` (an
// opaque, unbounded PG string of unknown content) and `method.card.number` /
// `.bin`. This ledger row is kept after the member leaves, so none of that may
// be written.
//
// The snapshot is built as an explicit OBJECT LITERAL from an allowlist. It is
// deliberately not "the payment minus some fields": a field PortOne adds later
// is NOT stored until someone chooses to add it here.
//
// What is kept is what is needed to find and reconcile a payment at the PG
// (ids, status, amount, timestamps, approval number, card brand/issuer). The
// receipt URL is intentionally left out: it is a link that can expose payment
// details to anyone holding it, and can be regenerated from the PG
// transaction id.
export const PAYMENT_SNAPSHOT_VERSION = 1;

type Rec = Record<string, unknown>;

function isRec(value: unknown): value is Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function str(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}
function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function compact(obj: Record<string, Json | undefined>): { [key: string]: Json } {
  const out: { [key: string]: Json } = {};
  for (const [key, value] of Object.entries(obj)) if (value !== undefined) out[key] = value;
  return out;
}

export function buildPaymentSnapshot(payment: unknown): Json {
  const p: Rec = isRec(payment) ? payment : {};
  const amount = isRec(p.amount) ? p.amount : {};
  const channel = isRec(p.channel) ? p.channel : {};
  const method = isRec(p.method) ? p.method : {};
  const card = isRec(method.card) ? method.card : {};

  const methodSnapshot = compact({
    type: str(method.type),
    approvalNumber: str(method.approvalNumber),
    cardBrand: str(card.brand),
    cardIssuer: str(card.issuer),
  });
  const channelSnapshot = compact({ pgProvider: str(channel.pgProvider) });

  return compact({
    snapshotVersion: PAYMENT_SNAPSHOT_VERSION,
    id: str(p.id),
    status: str(p.status),
    amountTotal: num(amount.total),
    currency: str(p.currency),
    paidAt: str(p.paidAt),
    requestedAt: str(p.requestedAt),
    statusChangedAt: str(p.statusChangedAt),
    pgTxId: str(p.pgTxId),
    transactionId: str(p.transactionId),
    storeId: str(p.storeId),
    merchantId: str(p.merchantId),
    channel: Object.keys(channelSnapshot).length ? channelSnapshot : undefined,
    method: Object.keys(methodSnapshot).length ? methodSnapshot : undefined,
  });
}

// A failure is recorded as a category only — never the provider's error
// object, which can echo request fields (billing key, customer id).
export function buildFailureSnapshot(failure: string, error?: unknown): Json {
  const data = isRec(error) && isRec((error as Rec).data) ? ((error as Rec).data as Rec) : {};
  return compact({
    snapshotVersion: PAYMENT_SNAPSHOT_VERSION,
    failure,
    errorType: str(data.type),
    errorCode: str(data.pgCode),
  });
}
