// Single source of truth for everything plan-related: price, AI credit
// budget, rate limit, and feature/save limits. Both the server-side
// enforcement (src/lib/ai/plan-limits.ts, used by quota checks) and the
// user-facing /pricing page read from this same config, so they can never
// drift apart. Change a plan's price or limits here only.
export type PlanTier = "FREE" | "BASIC" | "PRO";

export type PlanConfig = {
  tier: PlanTier;
  label: string;
  monthlyPriceKrw: number;
  monthlyCreditLimit: number;
  rateLimitPerMinute: number;
  // null = unlimited
  maxCollaborations: number | null;
  maxContents: number | null;
  photoBlogEnabled: boolean;
  photoAnalysisEnabled: boolean;
  partialRegenerateEnabled: boolean;
  contentRetention: string;
  recommendedFor: string;
  highlights: string[];
};

export const PLAN_CONFIGS: Record<PlanTier, PlanConfig> = {
  FREE: {
    tier: "FREE",
    label: "FREE",
    monthlyPriceKrw: 0,
    // STEP36: raised from 15 — a single real one-click run (가이드 분석 2 +
    // 사진 분석 10장 + 순서 추천 2 + 블로그 10 + Instagram 1 + Threads 1 = 26)
    // used to exhaust the entire FREE month before the user ever saw a
    // finished piece of content. 40 comfortably covers one full run plus a
    // guide check and a couple of partial regenerations, while staying well
    // below BASIC(100)/PRO(400) so the paid tiers keep their relative value.
    // This is a credit-allowance change, not a price change — FREE stays ₩0.
    monthlyCreditLimit: 40,
    // STEP36: the old 5/min was hit by ~5 sequential photo-analysis calls
    // inside the one-click pipeline (see the STEP36 report's rate-limit
    // section) — a legitimate batch of 10+ photos would always trip it.
    // Raised to keep meaningfully limiting automated abuse (credits remain
    // the real cost cap) while letting a normal one-click run finish.
    rateLimitPerMinute: 20,
    maxCollaborations: 3,
    maxContents: 15,
    photoBlogEnabled: false,
    photoAnalysisEnabled: false,
    partialRegenerateEnabled: false,
    contentRetention: "무제한 보관 (개수 제한 있음)",
    recommendedFor: "가입 후 CREVENA를 처음 써보는 분",
    highlights: [
      "텍스트 콘텐츠 생성 (Instagram/네이버블로그/Threads)",
      "협찬 최대 3건, 콘텐츠 최대 15건 저장",
      "사진 기반 기능 미포함",
    ],
  },
  BASIC: {
    tier: "BASIC",
    label: "BASIC",
    monthlyPriceKrw: 9900,
    monthlyCreditLimit: 100,
    rateLimitPerMinute: 30, // STEP36: same reasoning as FREE, scaled up
    maxCollaborations: 20,
    maxContents: 150,
    photoBlogEnabled: true,
    photoAnalysisEnabled: true,
    partialRegenerateEnabled: true,
    contentRetention: "무제한 보관",
    recommendedFor: "가끔 협찬을 진행하는 라이트 유저",
    highlights: [
      "텍스트 콘텐츠 생성 + 사진 기반 블로그 작성",
      "AI 사진 분석 · 문단 부분 재생성 포함",
      "협찬 최대 20건, 콘텐츠 최대 150건 저장",
    ],
  },
  PRO: {
    tier: "PRO",
    label: "PRO",
    monthlyPriceKrw: 29900,
    monthlyCreditLimit: 400,
    rateLimitPerMinute: 50, // STEP36: same reasoning as FREE, scaled up
    maxCollaborations: null,
    maxContents: null,
    photoBlogEnabled: true,
    photoAnalysisEnabled: true,
    partialRegenerateEnabled: true,
    contentRetention: "무제한 보관",
    recommendedFor: "협찬이 잦고 블로그·인스타·Threads를 함께 운영하는 분",
    highlights: [
      "BASIC의 모든 기능 + 넉넉한 크레딧",
      "협찬·콘텐츠 저장 개수 무제한",
      "분당 요청 한도가 가장 높아 사진이 많은 협찬도 한 번에 처리",
    ],
  },
};

export function normalizePlanTier(raw: string | null | undefined): PlanTier {
  const upper = (raw ?? "").toUpperCase();
  if (upper === "BASIC" || upper === "PRO") return upper;
  return "FREE";
}

export function getPlanConfig(raw: string | null | undefined): PlanConfig {
  return PLAN_CONFIGS[normalizePlanTier(raw)];
}
