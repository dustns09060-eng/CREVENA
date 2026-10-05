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
import {
  HOOK_MAX_CHARS,
  HOOK_MIN_CHARS,
  HOOK_STYLES,
  HOOKS_PER_ANGLE,
  MAX_ANGLES,
  MIN_ANGLES,
  RECOMMENDED_ANGLE_COUNT,
  RECOMMENDED_HOOK_COUNT,
  SALES_ANGLE_TYPES,
  type VersionAngle,
} from "@/lib/product-shorts/angle-types";

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
  // Shopping Shorts versions: the sales angle / hook this recommendation is for.
  angle?: VersionAngle | null;
  hook?: string | null;
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
    ...versionContextLines(input.angle, input.hook, "사진은 이 판매각도를 보여주기에 좋은 컷을 우선해서 골라라. 사진 설명에 없는 내용을 각도에 끼워 맞추지 마라."),
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
  // Shopping Shorts versions: the angle and the hook the user picked.
  angle?: VersionAngle | null;
  hook?: string | null;
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
    ...versionContextLines(
      input.angle,
      input.hook,
      "장면 구성과 자막은 이 판매각도를 따르되, 상품 정보에 없는 사실은 넣지 마라. 첫 장면 자막(hook 필드)은 위 후킹 문구를 그대로 써라.",
    ),
    "위 정보를 바탕으로 판매 숏츠 장면 구성을 만들어줘.",
  ];

  return { systemPrompt, prompt: promptParts.join("\n"), responseSchema: productShortsPlanSchema };
}


// ---------------------------------------------------------------------------
// Shopping Shorts versions: shared "this version's angle + hook" prompt section.
// ---------------------------------------------------------------------------

function versionContextLines(angle: VersionAngle | null | undefined, hook: string | null | undefined, instruction: string): string[] {
  if (!angle && !hook) return [];
  const lines = ["## 이 버전의 판매각도와 후킹"];
  if (angle) lines.push(`판매각도: ${angle.title} (${angle.type}) — ${angle.rationale}`);
  if (hook) lines.push(`사용자가 고른 후킹: ${hook}`);
  lines.push(instruction, "");
  return lines;
}

// ---------------------------------------------------------------------------
// 3. 판매각도 + 후킹 (ANGLE_HOOK_SUGGEST, 3 크레딧)
// ---------------------------------------------------------------------------

const hookItemSchema = {
  type: "object",
  properties: {
    text: { type: "string", description: `후킹 문구. ${HOOK_MIN_CHARS}~${HOOK_MAX_CHARS}자, 한 줄.` },
    style: { type: "string", enum: [...HOOK_STYLES] },
    recommended: { type: "boolean", description: `추천 후킹이면 true. 각도마다 정확히 ${RECOMMENDED_HOOK_COUNT}개.` },
  },
  required: ["text", "style", "recommended"],
};

export const productShortsAnglesSchema: ResponseSchema = {
  name: "submit_product_shorts_angles",
  description: "상품의 판매각도와 각 각도별 후킹 후보를 제출한다.",
  schema: {
    type: "object",
    properties: {
      angles: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: [...SALES_ANGLE_TYPES] },
            title: { type: "string", description: "각도 이름. 30자 이내." },
            rationale: { type: "string", description: "이 상품에 이 각도가 맞는 이유. 상품 정보에 있는 사실에만 근거. 120자 이내." },
            recommended: { type: "boolean", description: `추천 각도면 true. 전체에서 정확히 ${RECOMMENDED_ANGLE_COUNT}개(각도가 ${RECOMMENDED_ANGLE_COUNT}개 미만이면 전부).` },
            hooks: { type: "array", items: hookItemSchema, description: `정확히 ${HOOKS_PER_ANGLE}개` },
          },
          required: ["type", "title", "rationale", "recommended", "hooks"],
        },
      },
    },
    required: ["angles"],
  },
};

export const productShortsHooksSchema: ResponseSchema = {
  name: "submit_product_shorts_hooks",
  description: "선택한 판매각도의 후킹 후보를 제출한다.",
  schema: {
    type: "object",
    properties: { hooks: { type: "array", items: hookItemSchema, description: `정확히 ${HOOKS_PER_ANGLE}개` } },
    required: ["hooks"],
  },
};

const HOOK_QUALITY_RULES = [
  `## 후킹 규칙 (각도마다 정확히 ${HOOKS_PER_ANGLE}개)`,
  `- 한 줄, ${HOOK_MIN_CHARS}~${HOOK_MAX_CHARS}자. 서로 비슷한 문장을 반복하지 말고 최소 4가지 이상의 유형(style)을 섞어라.`,
  "- 유형: PROBLEM(문제제기) / EMPATHY(공감) / QUESTION(질문) / TARGET(타깃) / FEATURE(특징) / USE_SCENE(사용상황) / CONCLUSION(결론).",
  `- 추천(recommended)은 정확히 ${RECOMMENDED_HOOK_COUNT}개. 상품 정보에 근거가 가장 분명하고 과장 없이 눈길을 끄는 것을 골라라.`,
  "- 금지: 근거 없는 1위·최저가·품절대란·판매폭발·후기 수·만족도·오늘만·한정수량, 낚시성 문구, 공포 마케팅, 상품 정보에 없는 숫자.",
  "- 사용 경험을 지어내지 마라('써봤더니' 등은 사용자가 입력한 경험이 있을 때만).",
].join("\n");

export type ProductShortsAngleHookInput = {
  productSource: ProductSource;
  // ai_analysis text of the project's analyzed photos (already computed; reused, never re-run)
  photoDescriptions: string[];
  // When set, only the hooks for this one angle are generated.
  onlyAngle?: VersionAngle | null;
};

export function buildProductShortsAngleHookPrompt(input: ProductShortsAngleHookInput) {
  const only = input.onlyAngle ?? null;
  const systemPrompt = [
    only
      ? "너는 상품 판매 숏츠(짧은 세로 영상)의 후킹 문구를 만드는 어시스턴트다. 주어진 판매각도 하나에 대해서만 후킹을 만든다."
      : "너는 상품 판매 숏츠(짧은 세로 영상)의 판매각도와 후킹 문구를 기획하는 어시스턴트다.",
    NO_FABRICATION_RULE,
    PRODUCT_FACTS_ONLY_RULE,
    "",
    ...(only
      ? []
      : [
          "## 판매각도 규칙",
          `- ${MIN_ANGLES}~${MAX_ANGLES}개. 이 상품에 실제로 맞는 각도만 만들고, ${MAX_ANGLES}개를 채우려고 억지로 만들지 마라. 같은 유형을 두 번 쓰지 마라.`,
          "- 유형: PROBLEM_SOLVING(문제 해결형) / VALUE(가성비형) / FEATURE(특징형) / TARGET(타깃형) / USE_SCENE(사용상황형) / COMPARE(비교/선택형).",
          "- VALUE(가성비형)는 아래 '상품 정보'에 가격이 있을 때만 쓸 수 있다. 가격 근거가 없으면 만들지 마라.",
          "- COMPARE(비교/선택형)는 다른 상품명이나 수치를 지어내지 말고, '고를 때 보는 기준'처럼 상품 정보에서 말할 수 있는 선택 기준만 다뤄라.",
          `- 추천(recommended)은 정확히 ${RECOMMENDED_ANGLE_COUNT}개(각도가 ${RECOMMENDED_ANGLE_COUNT}개 미만이면 전부).`,
          "",
        ]),
    HOOK_QUALITY_RULES,
    "",
    `결과는 ${only ? productShortsHooksSchema.name : productShortsAnglesSchema.name} 도구를 호출해서 제출하라.`,
  ].join("\n");

  const p = input.productSource;
  const sourceLines = [`상품명: ${p.productName}`];
  if (p.priceText) sourceLines.push(`가격 텍스트: ${p.priceText}`);
  if (p.description) sourceLines.push(`설명: ${p.description}`);
  if (p.features.length > 0) sourceLines.push(`특징: ${p.features.join(" / ")}`);
  const evidenceLines = p.evidence.map((e) => `- [${e.source}] ${e.field}: ${e.value}`);
  const photoLines = input.photoDescriptions.slice(0, 12).map((d, i) => `- ${i + 1}. ${d.slice(0, 200)}`);

  const promptParts = [
    "## 상품 정보",
    sourceLines.join("\n"),
    "",
    "## 상품 정보 근거 (evidence — 실제로 확인된 내용만)",
    evidenceLines.length > 0 ? evidenceLines.join("\n") : "(없음)",
    "",
    "## 사진 분석 결과 (참고용 — 사진에 보이는 것만)",
    photoLines.length > 0 ? photoLines.join("\n") : "(없음)",
    "",
    ...(only ? ["## 후킹을 만들 판매각도", `${only.title} (${only.type}) — ${only.rationale}`, ""] : []),
    only ? "위 판매각도에 맞는 후킹 10개를 만들어줘." : "위 정보를 바탕으로 판매각도와 각도별 후킹을 만들어줘.",
  ];

  return {
    systemPrompt,
    prompt: promptParts.join("\n"),
    responseSchema: only ? productShortsHooksSchema : productShortsAnglesSchema,
  };
}
