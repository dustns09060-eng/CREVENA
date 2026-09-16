// Single source of truth for AI provider pricing. Change a price here and
// every cost estimate in the admin panel picks it up — nothing else should
// hardcode a $/token number.
//
// `verified` marks whether this price was confirmed against the provider's
// official pricing page (vs. a placeholder). Cost estimates computed from an
// unverified entry are flagged in the UI rather than presented as fact.
export type ModelPricing = {
  provider: string;
  model: string;
  inputPricePerMillion: number; // USD per 1,000,000 input tokens
  outputPricePerMillion: number; // USD per 1,000,000 output tokens
  verified: boolean;
  verifiedAt?: string;
  // Reserved for future providers that bill images as a flat per-image fee
  // instead of (or in addition to) input tokens. Unset = no flat fee.
  imageFlatFeeUsd?: number;
};

export const AI_PRICING: ModelPricing[] = [
  {
    provider: "claude",
    model: "claude-sonnet-5",
    inputPricePerMillion: 2,
    outputPricePerMillion: 10,
    verified: true,
    verifiedAt: "2026-09-11 (claude.com/pricing)",
  },
];

// Rough display-only conversion, NOT a billing rate. Update periodically;
// never rely on this for anything financial.
export const USD_TO_KRW_ESTIMATE = 1350;

export function getModelPricing(provider: string | null, model: string | null): ModelPricing | null {
  if (!provider || !model) return null;
  return AI_PRICING.find((p) => p.provider === provider && p.model === model) ?? null;
}

export type CostEstimate = {
  costUsd: number;
  verified: boolean;
};

// (input tokens / 1,000,000 × input 단가) + (output tokens / 1,000,000 × output 단가)
// Returns null when the provider/model isn't in AI_PRICING yet — callers
// should show "가격 확인 필요" rather than a silently-wrong $0.
export function estimateCostUsd(
  provider: string | null,
  model: string | null,
  inputTokens: number,
  outputTokens: number,
): CostEstimate | null {
  const pricing = getModelPricing(provider, model);
  if (!pricing) return null;
  const costUsd =
    (inputTokens / 1_000_000) * pricing.inputPricePerMillion +
    (outputTokens / 1_000_000) * pricing.outputPricePerMillion +
    (pricing.imageFlatFeeUsd ?? 0);
  return { costUsd, verified: pricing.verified };
}
