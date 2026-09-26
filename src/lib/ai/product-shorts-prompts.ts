// Product Shorts (상품 판매 숏츠) — Phase 4 AI prompts.
//
// Reuses existing infra as instructed: NO_FABRICATION_RULE (photo-blog-prompts.ts),
// the ORDER_SUGGEST call shape (/api/ai/suggest-order, 2 credits) for photo
// recommendation, and the REELS_PLAN call shape (5 credits, via a new thin
// /api/product-shorts/plan route — see that file for why a new ROUTE was
// needed even though the credit operation/price is unchanged) for scene
// composition. No new AiOperation, no price change.
//
// Both prompts send photo ids as short aliases ("p1", "p2", ...) instead of
// raw UUIDs — see src/lib/product-shorts/photo-alias.ts for why this is new
// work, not a reuse of prior art.

import { NO_FABRICATION_RULE } from "./photo-blog-prompts";
import type { ProductSource } from "@/lib/product-shorts/types";
import { PRODUCT_SHORTS_PHOTO_ROLES } from "@/lib/product-shorts/recommendation-types";
import type { ResponseSchema } from "./types";

// Section 10's evidence-gated claim list, reused by both the recommendation
// prompt (reasons must not invent selling points) and the plan prompt
// (captions/hook/CTA must not invent them either).
export const PRODUCT_FACTS_ONLY_RULE = [
  "판매 문구나 추천 이유에 담기는 모든 핵심 주장은 반드시 아래 '상품 정보'의 evidence 항목에 실제로 있는 내용이거나,",
  "사용자가 직접 입력한 실제 사용 경험(입력되어 있을 때만) 중 하나로 뒷받침되어야 한다. 상품명이나 사진만 보고 추측해서 지어내면 안 된다.",
  "다음 표현은 evidence로 뒷받침되지 않으면 절대 쓰지 마라: 판매량, 후기 수, 만족도, 순위/1위, 베스트셀러, 효능, 인증, 할인율, 최저가, 무료배송, 한정수량, 품절임박, 사용자 경험/반응.",
  "특히 건강기능식품·식품·화장품류는 사진이나 상품명만 보고 효능을 만들어내면 절대 안 된다.",
  "과장 표현('요즘 난리난', '품절대란', '무조건 사야 하는', '판매 1위') 금지.",
].join("\n");

// ---------------------------------------------------------------------------
// 1. 사진 추천 (ORDER_SUGGEST 재사용, 2 크레딧)
// ---------------------------------------------------------------------------

export type ProductShortsAliasedPhoto = {
  alias: string; // "p1", "p2", ... — never a raw mediaId
  description: string; // product_shorts_media.ai_analysis
};

export type ProductShortsRecommendInput = {
  productSource: ProductSource;
  reviewNotes?: string | null; // free-text real user experience, if any
  photos: ProductShortsAliasedPhoto[];
};

export const productShortsRecommendSchema: ResponseSchema = {
  name: "submit_product_shorts_recommendation",
  description: "판매 숏츠에 쓸 사진 추천 결과를 제출한다.",
  schema: {
    type: "object",
    properties: {
      selectedIds: { type: "array", items: { type: "string" }, description: "추천 순서대로 나열한 alias 목록" },
      coverCandidateIds: { type: "array", items: { type: "string" }, description: "대표 이미지 후보 alias 1~3개. selectedIds 안에 있어야 한다." },
      excludedIds: { type: "array", items: { type: "string" }, description: "추천하지 않는 alias 목록" },
      missingShots: {
        type: "array",
        items: { type: "string" },
        description: "판매에 있으면 좋지만 제공된 사진 중에는 없는 컷 종류 (예: '가격표가 보이는 컷'). 실제로 없을 때만 정직하게 보고. 억지로 채우지 마라.",
      },
      reasons: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "alias" },
            reason: { type: "string", description: "추천/미추천 이유를 25자 내외로" },
            role: { type: "string", enum: [...PRODUCT_SHORTS_PHOTO_ROLES] },
          },
          required: ["id", "reason", "role"],
        },
      },
    },
    required: ["selectedIds", "coverCandidateIds", "excludedIds", "missingShots", "reasons"],
  },
};

export function buildProductShortsRecommendPrompt(input: ProductShortsRecommendInput) {
  const systemPrompt = [
    "너는 상품 판매 숏츠(짧은 세로 영상)에 쓸 사진을 고르는 어시스턴트다.",
    NO_FABRICATION_RULE,
    PRODUCT_FACTS_ONLY_RULE,
    "",
    "## 절대 규칙",
    "1. id는 아래 '사진 목록'에 실제로 있는 alias만 써라 (p1, p2, ... 형태). 새 id를 만들어내면 안 된다.",
    "2. 상품에 실제로 없는 장면을 '꼭 있어야 하는 컷'이라며 억지로 만들어내지 마라. missingShots는 정말 없을 때만, 있는 그대로 짧게 적어라.",
    "3. 역할(role)은 대표 상품컷(COVER)/패키지컷(PACKAGE)/디테일컷(DETAIL)/사용·연출컷(USAGE)/특징 설명컷(FEATURE)/CTA용 컷(CTA)/기타(OTHER) 중 하나로 판단하라.",
    "4. 사람의 외모·매력도 등 사람 자체에 대한 평가는 하지 마라.",
    "",
    "결과는 submit_product_shorts_recommendation 도구를 호출해서 제출하라.",
  ].join("\n");

  const sourceLines = [`상품명: ${input.productSource.productName}`];
  if (input.productSource.priceText) sourceLines.push(`가격 텍스트: ${input.productSource.priceText}`);
  if (input.productSource.description) sourceLines.push(`설명: ${input.productSource.description}`);
  if (input.productSource.features.length > 0) sourceLines.push(`특징: ${input.productSource.features.join(" / ")}`);
  const evidenceLines = input.productSource.evidence.map((e) => `- [${e.source}] ${e.field}: ${e.value}`);

  const photoLines = input.photos.map((p) => `- id: ${p.alias} | 사진 설명: ${p.description}`).join("\n");

  const promptParts = [
    "## 상품 정보",
    sourceLines.join("\n"),
    "",
    "## 상품 정보 근거 (evidence — 실제로 확인된 내용만)",
    evidenceLines.length > 0 ? evidenceLines.join("\n") : "(없음)",
    "",
    "## 사용자가 입력한 실제 사용 경험",
    input.reviewNotes?.trim() ? input.reviewNotes : "(없음 — 경험 기반 이유를 지어내지 마라)",
    "",
    "## 사진 목록 (이 id들만 사용 가능)",
    photoLines || "(없음)",
    "",
    "위 정보를 바탕으로 판매 숏츠에 쓸 사진을 추천해줘.",
  ];

  return { systemPrompt, prompt: promptParts.join("\n"), responseSchema: productShortsRecommendSchema };
}

// ---------------------------------------------------------------------------
// 2. 15초/30초 판매 숏츠 장면 구성 (REELS_PLAN 재사용, 5 크레딧)
// ---------------------------------------------------------------------------

export type ProductShortsPlanInput = {
  productSource: ProductSource;
  reviewNotes?: string | null;
  targetDurationSeconds: 15 | 30;
  // Final user-selected photos only, in the user's chosen order — the AI
  // must build scenes from exactly this set, nothing else.
  selectedPhotos: ProductShortsAliasedPhoto[];
};

export const productShortsPlanSchema: ResponseSchema = {
  name: "submit_product_shorts_plan",
  description: "판매 숏츠 장면 구성을 제출한다.",
  schema: {
    type: "object",
    properties: {
      scenes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            mediaId: { type: "string", description: "alias. 반드시 전달받은 사진 목록 안에 있어야 한다." },
            durationSeconds: { type: "number", description: "이 장면의 길이(초)" },
            caption: { type: "string", description: "화면에 표시할 짧은 자막. evidence로 뒷받침되지 않는 주장은 넣지 마라." },
          },
          required: ["mediaId", "durationSeconds", "caption"],
        },
      },
      hook: { type: "string", description: "첫 장면 자막으로 쓸 후킹 문구. 과장 금지." },
      ctaText: { type: "string", description: "마지막 장면의 CTA 문구." },
    },
    required: ["scenes", "hook", "ctaText"],
  },
};

const HOOK_GUIDANCE = [
  "## Hook (첫 장면 문구) 가이드",
  "과장 없이 담백하게. 예시(참고용, 그대로 베끼지 말고 상품에 맞게): '이런 제품 찾고 있었다면', '상품 특징을 간단히 보여드릴게요'.",
  "'요즘 사용 중인 제품을 소개해요' 류의 실제 사용 경험 표현은 사용자가 입력한 실제 경험이 있을 때만 써라.",
  "절대 쓰면 안 되는 표현: '요즘 난리난', '품절대란', '무조건 사야 하는', '판매 1위'.",
].join("\n");

const CTA_GUIDANCE = [
  "## CTA(마지막 장면) 가이드",
  "source_url이 있으면 기본 문구는 '자세한 내용은 상품페이지에서 확인해 주세요.'",
  "source_url이 없으면 '상품 정보를 확인해 주세요.'",
  "가격이나 혜택을 CTA에 넣으려면 evidence로 뒷받침되는 내용만 써라. 근거 없으면 넣지 마라.",
].join("\n");

export function buildProductShortsPlanPrompt(input: ProductShortsPlanInput) {
  const sceneRange = input.targetDurationSeconds === 15 ? "4~6개" : "6~10개";

  const systemPrompt = [
    "너는 상품 판매 숏츠(짧은 세로 영상)의 장면 구성을 만드는 어시스턴트다.",
    NO_FABRICATION_RULE,
    PRODUCT_FACTS_ONLY_RULE,
    "",
    "## 절대 규칙",
    `1. mediaId는 아래 '선택된 사진 목록'에 있는 alias만 써라. 목표 길이는 ${input.targetDurationSeconds}초이고, 전체 장면 durationSeconds 합은 목표 길이에 최대한 가깝게(허용 오차 ±2초) 맞춰라.`,
    `2. 장면 개수는 대략 ${sceneRange} 정도가 자연스럽지만, 정확한 개수를 강제로 맞추기보다 duration 합이 목표에 맞는 걸 우선하라.`,
    "3. 선택된 사진 목록에 없는 사진을 쓰거나 새 alias를 만들어내면 안 된다.",
    HOOK_GUIDANCE,
    CTA_GUIDANCE,
    "",
    "결과는 submit_product_shorts_plan 도구를 호출해서 제출하라.",
  ].join("\n");

  const sourceLines = [`상품명: ${input.productSource.productName}`, `source_url: ${input.productSource.sourceUrl ?? "(없음)"}`];
  if (input.productSource.priceText) sourceLines.push(`가격 텍스트: ${input.productSource.priceText}`);
  if (input.productSource.description) sourceLines.push(`설명: ${input.productSource.description}`);
  if (input.productSource.features.length > 0) sourceLines.push(`특징: ${input.productSource.features.join(" / ")}`);
  const evidenceLines = input.productSource.evidence.map((e) => `- [${e.source}] ${e.field}: ${e.value}`);

  const photoLines = input.selectedPhotos
    .map((p, i) => `${i + 1}. id: ${p.alias} | 사진 설명: ${p.description}`)
    .join("\n");

  const promptParts = [
    "## 상품 정보",
    sourceLines.join("\n"),
    "",
    "## 상품 정보 근거 (evidence)",
    evidenceLines.length > 0 ? evidenceLines.join("\n") : "(없음)",
    "",
    "## 사용자가 입력한 실제 사용 경험",
    input.reviewNotes?.trim() ? input.reviewNotes : "(없음 — 경험 기반 문구를 지어내지 마라)",
    "",
    `## 선택된 사진 목록 (사용자가 최종 선택한 순서, 목표 길이 ${input.targetDurationSeconds}초)`,
    photoLines || "(없음)",
    "",
    "위 정보를 바탕으로 판매 숏츠 장면 구성을 만들어줘.",
  ];

  return { systemPrompt, prompt: promptParts.join("\n"), responseSchema: productShortsPlanSchema };
}
