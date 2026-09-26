// Allowlist transform: NAVER response -> the few fields CREVENA needs ->
// ProductSource. The raw response is never forwarded anywhere. Only fields
// verified in a real API response are read:
//   originProduct.name, originProduct.salePrice, originProduct.detailContent.
// features and images are deliberately NOT mapped (features has no verified
// direct field; images are not downloaded/imported in this phase). Product
// numbers are not in the response body, so none are read from it.

import type { ProductEvidence, ProductSource } from "@/lib/product-shorts/types";
import { NaverCommerceError } from "./errors";
import { htmlToText } from "./html-to-text";

export const NAVER_DESCRIPTION_MAX_LENGTH = 2000;
const NAME_MAX_LENGTH = 300;

export type NaverProductSummary = {
  name: string;
  salePrice: number | null;
  detailText: string | null;
};

export function summarizeNaverProduct(raw: unknown): NaverProductSummary {
  const origin = (raw && typeof raw === "object" ? (raw as Record<string, unknown>).originProduct : null) as Record<string, unknown> | null;
  if (!origin || typeof origin !== "object") throw new NaverCommerceError("NAVER_FETCH_FAILED");

  const name = typeof origin.name === "string" ? origin.name.replace(/\s+/g, " ").trim().slice(0, NAME_MAX_LENGTH) : "";
  if (!name) throw new NaverCommerceError("NAVER_FETCH_FAILED");

  const salePrice =
    typeof origin.salePrice === "number" && Number.isFinite(origin.salePrice) && origin.salePrice >= 0 ? origin.salePrice : null;

  const detail = typeof origin.detailContent === "string" ? htmlToText(origin.detailContent, NAVER_DESCRIPTION_MAX_LENGTH) : "";
  return { name, salePrice, detailText: detail || null };
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
  if (summary.detailText) evidence.push({ field: "description", value: summary.detailText, source: "NAVER_COMMERCE" });

  return {
    sourceUrl: normalizedUrl,
    sourceHost: host,
    productName: summary.name,
    priceText,
    description: summary.detailText,
    features: [],
    imageCandidates: [],
    evidence,
  };
}
