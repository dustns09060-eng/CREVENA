// Phase 2 design, unchanged in Phase 3A — see the PR report for why this
// shape was chosen (matches ReelsMediaSummary/ReelsPlanInput conventions
// already established for REELS_PLAN).

export type ProductEvidenceSource = "JSON_LD" | "OPEN_GRAPH" | "META" | "USER" | "NAVER_COMMERCE";

export type ProductEvidence = {
  field: string; // e.g. "productName", "priceText", "features[0]"
  value: string;
  source: ProductEvidenceSource;
};

export type ProductSource = {
  sourceUrl: string | null; // null when the user used the manual-entry fallback
  sourceHost: string | null;

  productName: string;
  priceText?: string | null;
  description?: string | null;
  features: string[];

  imageCandidates: string[]; // original external URLs — NOT yet in Storage, NOT yet fetched by anything

  evidence: ProductEvidence[]; // one entry per field actually found in the source; never fabricated
};
