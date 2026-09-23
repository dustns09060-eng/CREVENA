import type { ProductEvidence, ProductEvidenceSource, ProductSource } from "./types";

// Builds a ProductSource entirely from what a user typed by hand (no URL
// analysis, no AI). Every field the user actually filled in gets a "USER"
// evidence entry; a field left blank gets no evidence entry at all — never
// invented.
export function buildManualProductSource(input: {
  productName: string;
  priceText?: string | null;
  description?: string | null;
  features?: string[];
  sourceUrl?: string | null;
}): ProductSource {
  const evidence: ProductEvidence[] = [];
  const trimmedName = input.productName.trim();
  evidence.push({ field: "productName", value: trimmedName, source: "USER" });

  const priceText = input.priceText?.trim() || null;
  if (priceText) evidence.push({ field: "priceText", value: priceText, source: "USER" });

  const description = input.description?.trim() || null;
  if (description) evidence.push({ field: "description", value: description, source: "USER" });

  const features = (input.features ?? []).map((f) => f.trim()).filter(Boolean);
  features.forEach((f, i) => evidence.push({ field: `features[${i}]`, value: f, source: "USER" }));

  let sourceUrl: string | null = null;
  let sourceHost: string | null = null;
  if (input.sourceUrl?.trim()) {
    try {
      const url = new URL(input.sourceUrl.trim());
      sourceUrl = url.toString();
      sourceHost = url.hostname;
    } catch {
      // Not a valid URL — the user typed something into the optional "판매
      // 링크" field that isn't a real URL. Silently drop it rather than
      // store garbage; this field is optional and non-critical.
    }
  }

  return {
    sourceUrl,
    sourceHost,
    productName: trimmedName,
    priceText,
    description,
    features,
    imageCandidates: [], // manual entry never has externally-discovered image URLs
    evidence,
  };
}

// When a user edits a field that was originally auto-extracted (JSON_LD/
// OPEN_GRAPH/META), the edited field's evidence must flip to USER — the
// value no longer reflects what the page actually said, it reflects what
// the user typed. The ORIGINAL auto-extracted value is never preferred
// over what the user changed it to.
export function applyUserEdit(
  source: ProductSource,
  field: "productName" | "priceText" | "description",
  newValue: string,
): ProductSource {
  const trimmed = newValue.trim();
  const withoutOldEvidence = source.evidence.filter((e) => e.field !== field);
  const nextEvidence: ProductEvidence[] = trimmed
    ? [...withoutOldEvidence, { field, value: trimmed, source: "USER" as ProductEvidenceSource }]
    : withoutOldEvidence; // cleared by the user — no evidence for an empty field

  return {
    ...source,
    [field]: trimmed || (field === "productName" ? source.productName : null),
    evidence: nextEvidence,
  };
}

export function applyUserFeaturesEdit(source: ProductSource, features: string[]): ProductSource {
  const cleaned = features.map((f) => f.trim()).filter(Boolean);
  const withoutOldFeatureEvidence = source.evidence.filter((e) => !e.field.startsWith("features["));
  const featureEvidence: ProductEvidence[] = cleaned.map((f, i) => ({
    field: `features[${i}]`,
    value: f,
    source: "USER" as ProductEvidenceSource,
  }));
  return { ...source, features: cleaned, evidence: [...withoutOldFeatureEvidence, ...featureEvidence] };
}
