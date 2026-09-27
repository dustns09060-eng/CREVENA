// SERVER-ONLY. NAVER Commerce API client for the operator's own
// ("내 스토어 애플리케이션", type=SELF) application. Never import this from a
// "use client" file: it reads NAVER_COMMERCE_CLIENT_SECRET.
//
// Secrets/tokens are never logged, returned, or persisted. The access token
// lives only in this module's memory (a serverless instance change simply
// triggers a re-issue, which is fine for single-operator use).

import bcrypt from "bcryptjs";
import { NaverCommerceError, classifyNaverFailure } from "./errors";

const API_BASE = "https://api.commerce.naver.com/external";
const REQUEST_TIMEOUT_MS = 15_000;
// Refresh this long before the reported expiry.
const EXPIRY_SAFETY_MS = 5 * 60 * 1000;
const MIN_TOKEN_LIFETIME_MS = 30 * 1000;

export type NaverCredentials = { clientId: string; clientSecret: string };
type TokenCache = { accessToken: string; expiresAt: number };
type Deps = { fetchImpl?: typeof fetch; now?: () => number };

const BCRYPT_SALT_SHAPE = /^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{22}/;

let tokenCache: TokenCache | null = null;

export function readNaverCredentials(env: Record<string, string | undefined> = process.env): NaverCredentials | null {
  const clientId = env.NAVER_COMMERCE_CLIENT_ID?.trim();
  const clientSecret = env.NAVER_COMMERCE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  // The Commerce API client secret is itself a bcrypt salt ("$2a$10$..."). A
  // value that does not look like one is almost always a .env file where
  // "$" was variable-expanded away (escape it as \$ in .env.local). Treat
  // it as not configured instead of sending a request that cannot succeed.
  if (!BCRYPT_SALT_SHAPE.test(clientSecret)) {
    console.error("[naver-commerce] NAVER_COMMERCE_CLIENT_SECRET is not a bcrypt salt (check '$' escaping in .env)");
    return null;
  }
  return { clientId, clientSecret };
}

// Official spec (NAVER Commerce API 인증): client_secret_sign =
// base64( bcrypt( `${client_id}_${timestamp}`, salt = client_secret ) ),
// timestamp = Unix time in milliseconds, sent form-encoded together with
// grant_type=client_credentials and type=SELF.
export function buildClientSecretSign(clientId: string, clientSecret: string, timestampMs: number): string {
  const hashed = bcrypt.hashSync(`${clientId}_${timestampMs}`, clientSecret);
  return Buffer.from(hashed, "utf-8").toString("base64");
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  // Decode as UTF-8 explicitly instead of relying on the response charset.
  const bytes = new Uint8Array(await res.arrayBuffer());
  try {
    const parsed = JSON.parse(new TextDecoder("utf-8").decode(bytes));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function resetNaverTokenCacheForTests() {
  tokenCache = null;
}

export async function getSelfAccessToken(creds: NaverCredentials, deps: Deps = {}): Promise<string> {
  const now = deps.now ?? Date.now;
  if (tokenCache && tokenCache.expiresAt > now()) return tokenCache.accessToken;

  const fetchImpl = deps.fetchImpl ?? fetch;
  const timestamp = now();
  const body = new URLSearchParams({
    client_id: creds.clientId,
    timestamp: String(timestamp),
    client_secret_sign: buildClientSecretSign(creds.clientId, creds.clientSecret, timestamp),
    grant_type: "client_credentials",
    type: "SELF",
  });

  let res: Response;
  try {
    res = await fetchImpl(`${API_BASE}/v1/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new NaverCommerceError("NAVER_FETCH_FAILED");
  }
  const json = await readJson(res);
  if (!res.ok || typeof json.access_token !== "string" || !json.access_token) {
    throw new NaverCommerceError(
      classifyNaverFailure(res.status, typeof json.code === "string" ? json.code : undefined, "token"),
      res.status,
    );
  }
  const expiresInSec = typeof json.expires_in === "number" ? json.expires_in : 0;
  const lifetimeMs = Math.max(MIN_TOKEN_LIFETIME_MS, expiresInSec * 1000 - EXPIRY_SAFETY_MS);
  tokenCache = { accessToken: json.access_token, expiresAt: now() + lifetimeMs };
  return json.access_token;
}

// Single-product lookup by channelProductNo. Returns the parsed body to the
// caller INSIDE the server only — callers must run it through the allowlist
// mapper (map-product.ts) before anything leaves the server.
export async function fetchChannelProduct(
  channelProductNo: string,
  creds: NaverCredentials,
  deps: Deps = {},
): Promise<Record<string, unknown>> {
  if (!/^[0-9]{1,20}$/.test(channelProductNo)) throw new NaverCommerceError("NAVER_PRODUCT_NOT_FOUND");
  const fetchImpl = deps.fetchImpl ?? fetch;

  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getSelfAccessToken(creds, deps);
    let res: Response;
    try {
      res = await fetchImpl(`${API_BASE}/v2/products/channel-products/${channelProductNo}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      });
    } catch {
      throw new NaverCommerceError("NAVER_FETCH_FAILED");
    }
    const json = await readJson(res);
    if (res.ok) return json;
    // A cached token can be rejected before its reported expiry: drop it and
    // retry once with a fresh one.
    if (res.status === 401 && attempt === 0) {
      tokenCache = null;
      continue;
    }
    throw new NaverCommerceError(
      classifyNaverFailure(res.status, typeof json.code === "string" ? json.code : undefined, "product"),
      res.status,
    );
  }
  throw new NaverCommerceError("NAVER_AUTH_FAILED");
}
