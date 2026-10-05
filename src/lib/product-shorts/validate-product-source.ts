// Server-side gate for a ProductSource that arrives from the client
// (createProject / updateProductSource). The client is never trusted for:
//   - platform   -> recomputed from sourceUrl
//   - sourceHost -> recomputed from sourceUrl
//   - evidence   -> only allow-listed sources/fields, and NAVER_COMMERCE only
//                   for a NAVER URL on the fields that adapter really fills.
// Anything malformed is rejected; nothing is "repaired" into a different fact.
//
// Known limit: this cannot prove that an allowed evidence entry (e.g. JSON_LD)
// really came from that page — that would need the server to sign what
// analyze-url returned. It only removes forgeries the data itself disproves.

import { detectShoppingPlatform } from "./detect-platform";
import type { ProductEvidence, ProductEvidenceSource, ProductSource } from "./types";

const EVIDENCE_SOURCES: readonly ProductEvidenceSource[] = ["JSON_LD", "OPEN_GRAPH", "META", "USER", "NAVER_COMMERCE"];
const NAVER_COMMERCE_FIELDS = new Set(["productName", "priceText"]); // what map-product.ts fills

const MAX = {
  url: 2048,
  name: 300,
  price: 100,
  description: 5000,
  feature: 300,
  features: 30,
  images: 30,
  evidence: 120,
  evidenceValue: 5000,
} as const;

const EVIDENCE_FIELD = /^(productName|priceText|description|features\[\d{1,2}\]|imageCandidates\[\])$/;

export type SanitizeProductSourceResult = { ok: true; source: ProductSource } | { ok: false; reason: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function optionalString(v: unknown, max: number): string | null | "invalid" {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string" || v.length > max) return "invalid";
  const t = v.trim();
  return t ? t : null;
}

function parseHttpUrl(v: unknown): { href: string; hostname: string } | null | "invalid" {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || v.length > MAX.url) return "invalid";
  try {
    const u = new URL(v.trim());
    if ((u.protocol !== "http:" && u.protocol !== "https:") || u.username || u.password) return "invalid";
    return { href: u.toString(), hostname: u.hostname };
  } catch {
    return "invalid";
  }
}

export function sanitizeProductSource(input: unknown): SanitizeProductSourceResult {
  if (!isRecord(input)) return { ok: false, reason: "not an object" };

  const productName = typeof input.productName === "string" ? input.productName.trim() : "";
  if (!productName || productName.length > MAX.name) return { ok: false, reason: "productName" };

  const price = optionalString(input.priceText, MAX.price);
  const description = optionalString(input.description, MAX.description);
  if (price === "invalid" || description === "invalid") return { ok: false, reason: "text field" };

  const url = parseHttpUrl(input.sourceUrl);
  if (url === "invalid") return { ok: false, reason: "sourceUrl" };

  if (!Array.isArray(input.features) || input.features.length > MAX.features) return { ok: false, reason: "features" };
  const features: string[] = [];
  for (const f of input.features) {
    if (typeof f !== "string" || f.length > MAX.feature) return { ok: false, reason: "features" };
    if (f.trim()) features.push(f.trim());
  }

  if (!Array.isArray(input.imageCandidates) || input.imageCandidates.length > MAX.images) {
    return { ok: false, reason: "imageCandidates" };
  }
  const imageCandidates: string[] = [];
  for (const img of input.imageCandidates) {
    // Candidates are only ever shown/quoted as text; nothing fetches them. Keep valid http(s) URLs only.
    const parsed = parseHttpUrl(img);
    if (parsed === "invalid" || parsed === null) continue;
    imageCandidates.push(parsed.href);
  }

  const platform = detectShoppingPlatform(url ? url.href : null);

  if (!Array.isArray(input.evidence) || input.evidence.length > MAX.evidence) return { ok: false, reason: "evidence" };
  const evidence: ProductEvidence[] = [];
  for (const e of input.evidence) {
    if (!isRecord(e)) return { ok: false, reason: "evidence entry" };
    const { field, value, source } = e;
    if (typeof field !== "string" || !EVIDENCE_FIELD.test(field)) return { ok: false, reason: "evidence field" };
    if (typeof value !== "string" || value.length > MAX.evidenceValue) return { ok: false, reason: "evidence value" };
    if (typeof source !== "string" || !(EVIDENCE_SOURCES as readonly string[]).includes(source)) {
      return { ok: false, reason: "evidence source" };
    }
    if (source === "NAVER_COMMERCE" && (platform !== "NAVER" || !NAVER_COMMERCE_FIELDS.has(field))) {
      return { ok: false, reason: "NAVER_COMMERCE evidence on a non-NAVER source" };
    }
    evidence.push({ field, value, source: source as ProductEvidenceSource });
  }

  return {
    ok: true,
    source: {
      sourceUrl: url ? url.href : null,
      sourceHost: url ? url.hostname : null,
      platform,
      productName,
      priceText: price,
      description,
      features,
      imageCandidates,
      evidence,
    },
  };
}
