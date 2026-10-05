// Allowlist transform: NAVER response -> the few fields CREVENA needs ->
// ProductSource. The raw response is never forwarded anywhere. Only fields
// verified in a real API response are read: originProduct.name and
// originProduct.salePrice.
//
// originProduct.detailContent is deliberately NOT read here. A real seller
// product's detailContent turned out to be transaction/return-policy
// boilerplate (no actual product description) and contained the seller's
// phone number — mapping it into description would both store personal data
// and hand a phone number to the AI prompt built from ProductSource later.
// Until a deterministic, personal-data-safe extraction is designed (see the
// Phase investigation report), NAVER-sourced projects leave description
// empty for the user to fill in themselves, exactly like a fresh manual
// entry. features and images are deliberately NOT mapped either (features
// has no verified direct field; images are not downloaded/imported in this
// phase). Product numbers are not in the response body, so none are read
// from it.

import { detectShoppingPlatform } from "@/lib/product-shorts/detect-platform";
import type { ProductEvidence, ProductSource } from "@/lib/product-shorts/types";
import { NaverCommerceError } from "./errors";

const NAME_MAX_LENGTH = 300;

export type NaverProductSummary = {
  name: string;
  salePrice: number | null;
};

export function summarizeNaverProduct(raw: unknown): NaverProductSummary {
  const origin = (raw && typeof raw === "object" ? (raw as Record<string, unknown>).originProduct : null) as Record<string, unknown> | null;
  if (!origin || typeof origin !== "object") throw new NaverCommerceError("NAVER_FETCH_FAILED");

  const name = typeof origin.name === "string" ? origin.name.replace(/\s+/g, " ").trim().slice(0, NAME_MAX_LENGTH) : "";
  if (!name) throw new NaverCommerceError("NAVER_FETCH_FAILED");

  const salePrice =
    typeof origin.salePrice === "number" && Number.isFinite(origin.salePrice) && origin.salePrice >= 0 ? origin.salePrice : null;

  return { name, salePrice };
}

export function formatKrw(price: number): string {
  return `${Math.round(price).toLocaleString("ko-KR")}원`;
}

export function buildProductSourceFromNaver(summary: NaverProductSummary, sourceUrl: string): ProductSource {
  let host: string | null = null;
  let normalizedUrl: string | null = null;
  try {
    const u = new URL(sourceUrl);
    normalizedUrl = u.toString();
    host = u.hostname;
  } catch {
    // sourceUrl was validated by the caller; keep null if it is somehow unparseable.
  }

  const priceText = summary.salePrice !== null ? formatKrw(summary.salePrice) : null;
  const evidence: ProductEvidence[] = [{ field: "productName", value: summary.name, source: "NAVER_COMMERCE" }];
  if (priceText) evidence.push({ field: "priceText", value: priceText, source: "NAVER_COMMERCE" });

  return {
    sourceUrl: normalizedUrl,
    sourceHost: host,
    platform: detectShoppingPlatform(normalizedUrl),
    productName: summary.name,
    priceText,
    description: null, // left for the user to fill in — see file header
    features: [],
    imageCandidates: [],
    evidence,
  };
}
