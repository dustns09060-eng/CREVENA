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
  snsAutomationScope: string;
  recommendedFor: string;
  highlights: string[];
};

export const PLAN_CONFIGS: Record<PlanTier, PlanConfig> = {
  FREE: {
    tier: "FREE",
    label: "FREE",
    monthlyPriceKrw: 0,
    monthlyCreditLimit: 15,
    rateLimitPerMinute: 5,
    maxCollaborations: 3,
    maxContents: 15,
    photoBlogEnabled: false,
    photoAnalysisEnabled: false,
    partialRegenerateEnabled: false,
    contentRetention: "무제한 보관 (개수 제한 있음)",
    snsAutomationScope: "제공 예정 없음",
    recommendedFor: "가입 후 CreatorFlow를 처음 써보는 분",
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
    rateLimitPerMinute: 15,
    maxCollaborations: 20,
    maxContents: 150,
    photoBlogEnabled: true,
    photoAnalysisEnabled: true,
    partialRegenerateEnabled: true,
    contentRetention: "무제한 보관",
    snsAutomationScope: "추후 유료 애드온으로 제공 예정",
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
    rateLimitPerMinute: 30,
    maxCollaborations: null,
    maxContents: null,
    photoBlogEnabled: true,
    photoAnalysisEnabled: true,
    partialRegenerateEnabled: true,
    contentRetention: "무제한 보관",
    snsAutomationScope: "출시 시 우선 제공 예정",
    recommendedFor: "협찬이 잦고 블로그·인스타·Threads를 함께 운영하는 분",
    highlights: [
      "BASIC의 모든 기능 + 넉넉한 크레딧",
      "협찬·콘텐츠 저장 개수 무제한",
      "향후 SNS 자동화 기능 우선 제공",
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
