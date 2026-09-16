import type { PhotoType } from "@/types/database";
import { PHOTO_TYPES } from "@/lib/photo-type";
import type { ReviewNotes, StyleSample } from "./prompts";
import type { ResponseSchema } from "./types";

export function parseJsonResponse<T>(text: string): T {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "");
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Claude occasionally emits raw newlines/tabs inside a JSON string value,
    // which JSON.parse rejects. Escape control characters found inside quoted
    // strings only, then retry once before giving up.
    const repaired = cleaned.replace(/"(?:[^"\\]|\\.)*"/g, (match) =>
      match.replace(/\r\n|\r|\n/g, "\\n").replace(/\t/g, "\\t"),
    );
    return JSON.parse(repaired) as T;
  }
}

const NO_FABRICATION_RULE =
  "사진에서 실제로 보이지 않는 사실이나 사용자가 제공하지 않은 경험을 절대로 지어내지 마라.";

export const photoAnalysisSchema: ResponseSchema = {
  name: "submit_photo_analysis",
  description: "분석한 사진의 유형과 설명을 제출한다.",
  schema: {
    type: "object",
    properties: {
      photo_type: { type: "string", enum: PHOTO_TYPES },
      description: { type: "string", description: "사진에 실제로 보이는 내용을 2~3문장으로" },
    },
    required: ["photo_type", "description"],
  },
};

export function buildPhotoAnalysisPrompt() {
  const systemPrompt = [
    "너는 협찬 제품 사진을 분석하는 어시스턴트다.",
    NO_FABRICATION_RULE,
    `photo_type은 반드시 다음 중 하나여야 한다: ${PHOTO_TYPES.join(", ")}`,
    "유형 판정은 반드시 아래 순서대로 확인해서, 가장 먼저 해당하는 유형 하나만 골라라 (뒤 항목과 동시에 해당해도 앞 항목을 우선한다):",
    "1) 영양정보표, 성분표, 사용법 텍스트, 바코드 등 '읽기 위한' 작은 글자/숫자/표가 화면의 상당 부분을 차지하도록 클로즈업되어 있는가? → 그렇다면 DETAIL. 패키지나 제품이 함께 보여도, 그 글자/표를 읽게 하려는 컷이면 무조건 DETAIL이다.",
    "2) 박스/용기가 아직 개봉 전이거나, 포장 상태 그대로 겉면의 디자인·로고·형태를 보여주는 컷인가? → 그렇다면 PACKAGE.",
    "3) 낱개 포장이나 여러 구성물이 개별적으로 펼쳐져 함께 보이는 컷인가? → 그렇다면 COMPONENTS.",
    "4) 포장을 벗겨낸 제품 본체 하나만 단독으로 보이는 컷인가(사람이 쓰는 중이 아님)? → 그렇다면 PRODUCT_ALONE.",
    "5) 사람이 실제로 사용 중인 모습인가? 성인이면 USAGE, 아이면 KID_USAGE.",
    "6) 여러 요소를 완성된 형태로 함께 보여주는 전체컷/결과컷인가? → FINAL_SHOT.",
    "7) 위 어디에도 해당하지 않으면 OTHER.",
    "분석 결과는 submit_photo_analysis 도구를 호출해서 제출하라.",
  ].join("\n");

  return { systemPrompt, prompt: "이 사진을 분석해줘.", responseSchema: photoAnalysisSchema };
}

export type PhotoSummary = {
  id: string;
  photoType: PhotoType | null;
  description: string;
  memo?: string | null;
};

export const photoOrderSchema: ResponseSchema = {
  name: "submit_photo_order",
  description: "추천하는 사진 배치 순서를 photoId 배열로 제출한다.",
  schema: {
    type: "object",
    properties: {
      order: { type: "array", items: { type: "string" }, description: "photoId를 추천 순서대로 나열" },
    },
    required: ["order"],
  },
};

export function buildPhotoOrderPrompt(photos: PhotoSummary[]) {
  const systemPrompt = [
    "너는 블로그 글의 사진 배치 순서를 추천하는 어시스턴트다.",
    "일반적인 협찬 후기 블로그 흐름(제품 소개 → 패키지/구성품 → 디테일 → 사용 모습 → 완성/결과)을 참고해 사진 순서를 정하라.",
    "추천 순서는 submit_photo_order 도구를 호출해서 제출하라.",
  ].join("\n");

  const list = photos
    .map((p) => `- id: ${p.id}, 유형: ${p.photoType ?? "미분류"}, 설명: ${p.description}`)
    .join("\n");

  const prompt = `아래 사진 목록을 블로그 글 흐름에 맞는 순서로 정렬해줘.\n\n${list}`;

  return { systemPrompt, prompt, responseSchema: photoOrderSchema };
}

export type PhotoBlogInput = {
  brandName: string;
  productName: string;
  campaignName?: string | null;
  requiredKeywords?: string | null;
  requiredHashtags?: string | null;
  adDisclosureText?: string | null;
  contentGuide?: string | null;
  guideRawContent?: string | null;
  reviewNotes: ReviewNotes;
  styleSamples?: StyleSample[];
  photos: PhotoSummary[];
};

const REVIEW_NOTE_LABELS: Record<keyof ReviewNotes, string> = {
  actualReview: "실제 사용 후기",
  pros: "좋았던 점",
  cons: "아쉬웠던 점",
  kidsReaction: "아이 반응",
  usageLocation: "사용 장소",
  usageSituation: "사용 상황",
  photoDescription: "사진 설명",
  personalExperience: "개인적인 경험",
};

export const photoBlogSchema: ResponseSchema = {
  name: "submit_photo_blog",
  description: "사진 순서에 맞춰 완성한 블로그 글을 제출한다.",
  schema: {
    type: "object",
    properties: {
      title: { type: "string" },
      intro: { type: "string" },
      sections: {
        type: "array",
        items: {
          type: "object",
          properties: {
            photoId: { type: "string" },
            body: { type: "string" },
          },
          required: ["photoId", "body"],
        },
      },
      closing: { type: "string" },
      hashtags: { type: "string" },
    },
    required: ["title", "intro", "sections", "closing", "hashtags"],
  },
};

export function buildPhotoBlogPrompt(input: PhotoBlogInput) {
  const systemPrompt = [
    "너는 인플루언서의 협찬 블로그 글을 사진 순서에 맞춰 작성하는 어시스턴트다.",
    NO_FABRICATION_RULE,
    "제품이나 브랜드에 대해 사실이 아닌 내용, 제공되지 않은 효과나 스펙을 지어내지 마라.",
    "네이버 블로그 글 구조: 제목 → 도입부 → (사진마다 본문 문단) → 마무리 → 해시태그.",
    "",
    "글 전체는 사진별 설명을 각각 따로 나열하지 말고, 처음부터 끝까지 하나로 이어지는 후기로 써라. 아래 흐름을 따르되 각 사진 문단(sections)이 이 흐름 중 해당 사진에 맞는 단계를 맡게 하라:",
    "문제 제기(평소 겪던 고민·필요) → 사용 계기(이 제품을 써보게 된 이유) → 제품 등장(첫인상, 패키지 등) → 실제 사용(사용 과정, 디테일 확인) → 변화·느낀점(써보고 달라진 점) → 추천 대상(어떤 사람에게 어울리는지) → 자연스러운 마무리.",
    "각 사진 문단 시작에는 바로 앞 문단 내용을 자연스럽게 이어받는 짧은 연결 문장을 넣어, 사진을 순서대로 읽으면 하나의 글처럼 이어지게 하라. 앞 문단에서 이미 쓴 장점이나 표현을 다른 문단에서 그대로 반복하지 마라.",
    "각 문단은 모바일 화면에서 읽기 편하도록 2~4문장 정도로 쓰고, 한 문단에 정보를 지나치게 몰아넣지 마라.",
    "제품 스펙이나 특징만 나열하는 광고 문구 톤을 피하고, 사용자가 입력한 실제 경험과 사진에서 확인되는 내용을 중심으로 담백하게 써라.",
    "도입부(intro)는 이 글에서 다룰 내용을 미리 다 설명하지 말고, 문제 제기와 사용 계기 정도만 자연스럽게 풀어서 독자가 본문을 계속 읽고 싶게 만들어라.",
    "마무리(closing)는 과장된 구매 유도 문구 대신, 실제로 써본 사람이 담백하게 정리하듯 추천 대상과 소감을 써라.",
    "",
    "각 사진의 AI 분석 결과와 사용자 메모를 참고해서 그 사진 자리에 들어갈 문단을 작성하라. 사용자 메모가 없으면 분석 결과만으로 담백하게 서술하라.",
    "필수 키워드가 있으면 본문 전체에 자연스럽게 녹여 포함하되, SEO를 위해 억지로 여러 번 반복해서 문장이 부자연스러워지지 않게 하라.",
    "완성된 글은 submit_photo_blog 도구를 호출해서 제출하라.",
  ].join("\n");

  const collabLines = [
    `브랜드: ${input.brandName}`,
    `제품명: ${input.productName}`,
  ];
  if (input.campaignName) collabLines.push(`캠페인: ${input.campaignName}`);
  if (input.requiredKeywords) collabLines.push(`필수 키워드: ${input.requiredKeywords}`);
  if (input.requiredHashtags) collabLines.push(`필수 해시태그: ${input.requiredHashtags}`);
  if (input.adDisclosureText) collabLines.push(`광고 표시 문구: ${input.adDisclosureText}`);
  if (input.contentGuide) collabLines.push(`콘텐츠 작성 가이드: ${input.contentGuide}`);
  if (input.guideRawContent) collabLines.push(`브랜드 가이드라인 원문:\n${input.guideRawContent}`);

  const reviewLines = (Object.keys(REVIEW_NOTE_LABELS) as (keyof ReviewNotes)[])
    .filter((key) => input.reviewNotes[key]?.trim())
    .map((key) => `${REVIEW_NOTE_LABELS[key]}: ${input.reviewNotes[key]}`);

  const photoLines = input.photos
    .map(
      (p, i) =>
        `${i + 1}. photoId: ${p.id} / 유형: ${p.photoType ?? "미분류"} / AI 분석: ${p.description}${
          p.memo ? ` / 사용자 메모: ${p.memo}` : ""
        }`,
    )
    .join("\n");

  const styleText =
    input.styleSamples && input.styleSamples.length > 0
      ? input.styleSamples.map((s) => `[${s.styleName}]\n${s.sampleText.slice(0, 800)}`).join("\n\n")
      : null;

  const promptParts = [
    "## 협찬 정보",
    collabLines.join("\n"),
    "",
    "## 사용자가 입력한 후기 메모",
    reviewLines.length > 0 ? reviewLines.join("\n") : "(없음)",
    "",
    "## 사진 순서 및 분석 (이 순서대로 sections를 작성)",
    photoLines,
  ];

  if (styleText) {
    promptParts.push("", "## 내 글 스타일 예시", styleText);
  }

  promptParts.push("", "위 정보를 바탕으로 사진 순서에 맞춰 블로그 글을 작성해줘.");

  return { systemPrompt, prompt: promptParts.join("\n"), responseSchema: photoBlogSchema };
}

export type GuideCheckInput = {
  fullText: string;
  requiredKeywords?: string | null;
  guideRawContent?: string | null;
  presentPhotoTypes: PhotoType[];
};

export const guideCheckSchema: ResponseSchema = {
  name: "submit_guide_check",
  description: "가이드라인 검사 결과를 제출한다.",
  schema: {
    type: "object",
    properties: {
      missingKeywords: { type: "array", items: { type: "string" } },
      notes: { type: "string", description: "가이드라인 위반 사항이나 개선 제안을 짧게" },
    },
    required: ["missingKeywords", "notes"],
  },
};

export function buildGuideCheckPrompt(input: GuideCheckInput) {
  const systemPrompt = [
    "너는 협찬 콘텐츠가 가이드라인을 충족하는지 검사하는 어시스턴트다.",
    "검사 결과는 submit_guide_check 도구를 호출해서 제출하라.",
  ].join("\n");

  const prompt = [
    "## 완성된 글",
    input.fullText,
    "",
    "## 필수 키워드",
    input.requiredKeywords ?? "(없음)",
    "",
    "## 브랜드 가이드라인 원문",
    input.guideRawContent ?? "(없음)",
    "",
    "## 현재 업로드된 사진 유형",
    input.presentPhotoTypes.length > 0 ? input.presentPhotoTypes.join(", ") : "(없음)",
    "",
    "필수 키워드가 글에 실제로 포함되어 있는지, 가이드라인을 위반한 부분이 있는지 확인해줘.",
  ].join("\n");

  return { systemPrompt, prompt, responseSchema: guideCheckSchema };
}

export type RegenerateMode = "REWRITE" | "NATURAL" | "SHORTER" | "LONGER";

const REGENERATE_MODE_INSTRUCTIONS: Record<RegenerateMode, string> = {
  REWRITE: "사진 분석과 메모를 바탕으로 이 문단을 처음부터 새로 작성하라.",
  NATURAL:
    "아래 '현재 문단'을 더 자연스럽고 편안한 구어체로 다듬어 다시 작성하라. 담긴 정보와 사실은 그대로 유지하라.",
  SHORTER:
    "아래 '현재 문단'을 더 짧고 간결하게 요약해서 다시 작성하라. 핵심 정보는 유지하고 불필요한 수식어를 줄여라.",
  LONGER:
    "아래 '현재 문단'을 더 길고 자세하게 풀어서 다시 작성하라. 사진 분석과 메모에 있는 내용 안에서만 묘사를 덧붙이고, 없는 사실은 절대 지어내지 마라.",
};

export type SinglePhotoSectionInput = {
  brandName: string;
  productName: string;
  requiredKeywords?: string | null;
  reviewNotes: ReviewNotes;
  styleSamples?: StyleSample[];
  photo: PhotoSummary;
  mode: RegenerateMode;
  currentBody?: string | null;
};

export const singlePhotoSectionSchema: ResponseSchema = {
  name: "submit_photo_section",
  description: "다시 작성한 문단 하나를 제출한다.",
  schema: {
    type: "object",
    properties: { body: { type: "string" } },
    required: ["body"],
  },
};

export function buildSinglePhotoSectionPrompt(input: SinglePhotoSectionInput) {
  const systemPrompt = [
    "너는 인플루언서 협찬 블로그 글 중 사진 한 장에 대응하는 문단 하나만 (다시) 작성하는 어시스턴트다.",
    NO_FABRICATION_RULE,
    "블로그 다른 부분과 자연스럽게 이어지는 하나의 문단만 작성하라. 2~4문장이 적당하다.",
    REGENERATE_MODE_INSTRUCTIONS[input.mode],
    "작성한 문단은 submit_photo_section 도구를 호출해서 제출하라.",
  ].join("\n");

  const lines = [
    `브랜드: ${input.brandName}`,
    `제품명: ${input.productName}`,
  ];
  if (input.requiredKeywords) lines.push(`필수 키워드: ${input.requiredKeywords}`);

  const reviewLines = (Object.keys(REVIEW_NOTE_LABELS) as (keyof ReviewNotes)[])
    .filter((key) => input.reviewNotes[key]?.trim())
    .map((key) => `${REVIEW_NOTE_LABELS[key]}: ${input.reviewNotes[key]}`);

  const promptParts = [
    "## 협찬 정보",
    lines.join("\n"),
    "",
    "## 사용자가 입력한 후기 메모",
    reviewLines.length > 0 ? reviewLines.join("\n") : "(없음)",
    "",
    "## 이 사진",
    `유형: ${input.photo.photoType ?? "미분류"} / AI 분석: ${input.photo.description}${
      input.photo.memo ? ` / 사용자 메모: ${input.photo.memo}` : ""
    }`,
  ];

  if (input.mode !== "REWRITE" && input.currentBody) {
    promptParts.push("", "## 현재 문단", input.currentBody);
  }

  const styleText =
    input.styleSamples && input.styleSamples.length > 0
      ? input.styleSamples.map((s) => `[${s.styleName}]\n${s.sampleText.slice(0, 800)}`).join("\n\n")
      : null;
  if (styleText) {
    promptParts.push("", "## 내 글 스타일 예시", styleText);
  }

  promptParts.push("", "위 정보를 바탕으로 이 사진에 대응하는 문단을 작성해줘.");

  return { systemPrompt, prompt: promptParts.join("\n"), responseSchema: singlePhotoSectionSchema };
}
