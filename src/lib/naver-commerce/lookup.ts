// Orchestrates the operator-only NAVER SELF lookup for Product Shorts.
//
// Exposure is intentionally minimal: this only works for the operator's own
// store (NAVER_COMMERCE_STORE_SLUG) and only for the user ids listed in
// NAVER_COMMERCE_OPERATOR_USER_IDS. Everyone else (and any environment
// without these variables, such as Production for now) gets
// NAVER_NOT_CONFIGURED and the normal manual-entry fallback. A URL for a
// different store never triggers a NAVER API call.

import type { ProductSource } from "@/lib/product-shorts/types";
import { parseSmartstoreProductUrl } from "./smartstore-url";
import { readNaverCredentials, fetchChannelProduct, type NaverCredentials } from "./client";
import { NaverCommerceError, type NaverCommerceErrorCode } from "./errors";
import { summarizeNaverProduct, buildProductSourceFromNaver } from "./map-product";

export type NaverLookupResult =
  | { handled: false } // not a SmartStore product URL -> caller uses the generic parser
  | { handled: true; ok: true; productSource: ProductSource }
  | { handled: true; ok: false; code: NaverCommerceErrorCode };

type Deps = { fetchProduct?: (no: string, creds: NaverCredentials) => Promise<Record<string, unknown>> };

export async function lookupNaverSelfProduct(
  input: { url: string; userId: string },
  env: Record<string, string | undefined> = process.env,
  deps: Deps = {},
): Promise<NaverLookupResult> {
  const ref = parseSmartstoreProductUrl(input.url);
  if (!ref) return { handled: false };

  const creds = readNaverCredentials(env);
  const operatorIds = (env.NAVER_COMMERCE_OPERATOR_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const ownStore = env.NAVER_COMMERCE_STORE_SLUG?.trim();
  if (!creds || !ownStore || !operatorIds.includes(input.userId)) {
    return { handled: true, ok: false, code: "NAVER_NOT_CONFIGURED" };
  }
  if (ref.storeSlug.toLowerCase() !== ownStore.toLowerCase()) {
    return { handled: true, ok: false, code: "NAVER_PRODUCT_NOT_FOUND" };
  }

  try {
    const raw = await (deps.fetchProduct ?? fetchChannelProduct)(ref.channelProductNo, creds);
    const summary = summarizeNaverProduct(raw);
    return { handled: true, ok: true, productSource: buildProductSourceFromNaver(summary, input.url.trim()) };
  } catch (error) {
    if (error instanceof NaverCommerceError) return { handled: true, ok: false, code: error.code };
    return { handled: true, ok: false, code: "NAVER_FETCH_FAILED" };
  }
}
