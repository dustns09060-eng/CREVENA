// The ONLY vocabulary analyze-url (and anything else in this feature that
// talks to an external URL) is allowed to return to the client. No raw
// upstream error text, no stack traces, no DNS/IP details, no upstream HTML
// — all of that stays server-side (console.error only, if logged at all).
// A route handler must never pass a caught error's .message through to
// NextResponse.json() for this feature.
export type ProductShortsErrorCode =
  | "INVALID_URL"
  | "BLOCKED_DESTINATION"
  | "FETCH_TIMEOUT"
  | "RESPONSE_TOO_LARGE"
  | "UNSUPPORTED_CONTENT"
  | "FETCH_FAILED"
  | "PRODUCT_NOT_FOUND";
