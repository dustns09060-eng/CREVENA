import type { ResponseSchema } from "./types";

// STEP35.5: structured extraction of a pasted brand guideline. Nothing here
// is persisted to the DB (see the STEP35.5 report for why) — the caller
// keeps this in memory for the current session and re-runs the analysis
// when needed. Uses the same forced tool-use pattern as every other
// structured AI call since STEP34, so the shape below is guaranteed by the
// API itself, not by a JSON.parse gamble.
export type GuideAnalysis = {
  brandName: string | null;
  productName: string | null;
  platforms: string[];
  titleKeywords: string[];
  bodyKeywords: string[];
  keywordRepeatCondition: string | null;
  minimumCharacters: number | null;
  minimumPhotos: number | null;
  requiresVideo: boolean;
  requiredPhrases: string[];
  hashtags: string[];
  accountTags: string[];
  requiredUrls: string[];
  prohibitedExpressions: string[];
  requiredPoints: string[];
  deadline: string | null;
  otherRequirements: string[];
};

export const guideAnalysisSchema: ResponseSchema = {
  name: "submit_guide_analysis",
  description: "업체 체험단 가이드라인 원문에서 구조화된 요구사항을 제출한다.",
  schema: {
    type: "object",
    properties: {
      brandName: { type: ["string", "null"] },
      productName: { type: ["string", "null"] },
      platforms: { type: "array", items: { type: "string" } },
      titleKeywords: { type: "array", items: { type: "string" } },
      bodyKeywords: { type: "array", items: { type: "string" } },
      keywordRepeatCondition: { type: ["string", "null"] },
      minimumCharacters: { type: ["number", "null"] },
      minimumPhotos: { type: ["number", "null"] },
      requiresVideo: { type: "boolean" },
      requiredPhrases: { type: "array", items: { type: "string" } },
      hashtags: { type: "array", items: { type: "string" } },
      accountTags: { type: "array", items: { type: "string" } },
      requiredUrls: { type: "array", items: { type: "string" } },
      prohibitedExpressions: { type: "array", items: { type: "string" } },
      requiredPoints: { type: "array", items: { type: "string" } },
      deadline: { type: ["string", "null"] },
      otherRequirements: { type: "array", items: { type: "string" } },
    },
    required: [
      "brandName",
      "productName",
      "platforms",
      "titleKeywords",
      "bodyKeywords",
      "keywordRepeatCondition",
      "minimumCharacters",
      "minimumPhotos",
      "requiresVideo",
      "requiredPhrases",
      "hashtags",
      "accountTags",
      "requiredUrls",
      "prohibitedExpressions",
      "requiredPoints",
      "deadline",
      "otherRequirements",
    ],
  },
};

export function buildGuideAnalysisPrompt(rawGuideText: string) {
  const systemPrompt = [
    "너는 인플루언서 체험단/협찬 가이드라인 원문을 분석해서 구조화된 요구사항을 추출하는 어시스턴트다.",
    "가이드에 실제로 적혀 있는 내용만 추출하라. 가이드에 없는 정보를 추측하거나 지어내지 마라.",
    "특정 항목이 가이드에 없으면 문자열/불리언 필드는 null 또는 false로, 배열 필드는 빈 배열로 남겨라.",
    "titleKeywords는 '제목에 반드시 포함' 같은 표현이 있는 키워드만, bodyKeywords는 본문에 포함해야 할 키워드다. 구분이 없으면 bodyKeywords에 넣어라.",
    "requiredPhrases는 '반드시 아래 문구를 포함하세요' 같은 정확한 문구 요구사항이다 (광고 표시 문구 포함).",
    "requiredPoints는 '제품의 OO 기능을 꼭 언급해주세요' 같은, 정확한 문구는 아니지만 내용상 반드시 다뤄야 하는 포인트다.",
    "결과는 submit_guide_analysis 도구를 호출해서 제출하라.",
  ].join("\n");

  const prompt = `아래는 업체에서 받은 체험단/협찬 가이드라인 원문이다. 구조화해서 추출해줘.\n\n${rawGuideText}`;

  return { systemPrompt, prompt, responseSchema: guideAnalysisSchema };
}
