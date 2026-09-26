// Fixed vocabulary returned to callers. Raw NAVER error bodies never leave
// the server-side client module.
export type NaverCommerceErrorCode =
  | "NAVER_NOT_CONFIGURED"
  | "NAVER_AUTH_FAILED"
  | "NAVER_IP_NOT_ALLOWED"
  | "NAVER_RATE_LIMITED"
  | "NAVER_PRODUCT_NOT_FOUND"
  | "NAVER_PERMISSION_DENIED"
  | "NAVER_FETCH_FAILED";

export class NaverCommerceError extends Error {
  constructor(
    readonly code: NaverCommerceErrorCode,
    readonly httpStatus?: number,
  ) {
    super(code);
    this.name = "NaverCommerceError";
  }
}

// Classifies an upstream failure from HTTP status + the response's own
// machine code (e.g. "GW.IP_NOT_ALLOWED"). Message text is never used for
// user output.
export function classifyNaverFailure(status: number, upstreamCode: string | undefined, stage: "token" | "product"): NaverCommerceErrorCode {
  const c = (upstreamCode ?? "").toUpperCase();
  if (status === 429 || c.includes("RATE") || c.includes("TOO_MANY")) return "NAVER_RATE_LIMITED";
  if (c.includes("IP_NOT_ALLOWED") || (c.includes("IP") && c.includes("ALLOW"))) return "NAVER_IP_NOT_ALLOWED";
  if (stage === "product" && (status === 404 || c.includes("NOT_FOUND") || c.includes("NOT_EXIST"))) return "NAVER_PRODUCT_NOT_FOUND";
  if (status === 403 || c.includes("PERMISSION") || c.includes("FORBIDDEN") || c.includes("AUTHZ")) return "NAVER_PERMISSION_DENIED";
  if (status === 401 || status === 400 || c.includes("AUTHN") || c.includes("SIGN") || c.includes("TIMESTAMP") || c.includes("CLIENT")) {
    return "NAVER_AUTH_FAILED";
  }
  return "NAVER_FETCH_FAILED";
}
