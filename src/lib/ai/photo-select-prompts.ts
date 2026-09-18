import type { PhotoType } from "@/types/database";
import { NO_FABRICATION_RULE } from "./photo-blog-prompts";
import { REVIEW_NOTE_LABELS } from "./photo-blog-prompts";
import type { ReviewNotes } from "./prompts";
import type { GuideAnalysis } from "./guide-analysis-prompts";
import { PHOTO_SELECT_ROLES } from "@/lib/photo-select";
import type { ResponseSchema } from "./types";

// STEP47: AI Photo Select — "이 협찬에서 실제로 쓸 사진 고르기".
//
// WHY THIS IS NOT A NEW AI OPERATION / CREDIT TYPE:
//   This is structurally the same call ORDER_SUGGEST already makes — the
//   same inputs (per-photo ai_analysis 텍스트 + photo_type), the same forced
//   tool-use JSON contract, the same one-shot "look at every photo
//   description at once and decide" shape — asking "어떤 사진을 쓸까"
//   instead of "어떤 순서로 놓을까" (and the existing photoOrderSchema
//   ALREADY returns excludePhotoIds + primaryPhotoId, i.e. a primitive
//   version of exactly this). It therefore goes through the existing
//   /api/ai/suggest-order route at the existing ORDER_SUGGEST price of 2
//   credits. No new operation was added to OPERATION_CREDIT_COST and no
//   existing price was changed — see the STEP47 report items 6/7/89/90.
//
// WHY THERE IS NO SEPARATE GUIDE-PARSING CALL:
//   GUIDE_ANALYZE (0-cost to re-use, already run in Content Studio) has no
//   "required shot/scene" field — its closest fields are requiredPoints /
//   otherRequirements / minimumPhotos, which are about the TEXT, not the
//   photos. Rather than add a second guide operation, the raw guide text is
//   passed into this same single call and the model extracts the 필수 촬영
//   컷 requirements as part of producing the recommendation. One call, one
//   existing price.

export type PhotoSelectPhoto = {
  id: string;
  photoType: PhotoType | null;
  description: string;
  memo?: string | null;
  /** 1-based upload/display position — a weak but free adjacency signal. */
  position: number;
  hasEdit: boolean;
};

export type PhotoSelectInput = {
  brandName: string;
  productName: string;
  guideRawContent?: string | null;
  guideAnalysis?: GuideAnalysis | null;
  reviewNotes: ReviewNotes;
  photos: PhotoSelectPhoto[];
  /** 꼭 사용 — must appear in selectedPhotoIds. */
  pinnedPhotoIds: string[];
  /** 제외 — must NOT appear anywhere in the output. */
  excludedPhotoIds: string[];
  /** Guide's structured minimum photo count, when known. */
  minimumPhotos?: number | null;
};

export const photoSelectSchema: ResponseSchema = {
  name: "submit_photo_selection",
  description: "실제로 사용할 사진 추천 결과를 제출한다.",
  schema: {
    type: "object",
    properties: {
      selectedPhotoIds: {
        type: "array",
        items: { type: "string" },
        description: "콘텐츠에 실제로 쓰기를 추천하는 photoId 목록 (추천 순서대로)",
      },
      coverCandidateIds: {
        type: "array",
        items: { type: "string" },
        description: "대표 이미지 후보 photoId 1~3개. selectedPhotoIds 안에 있는 값이어야 한다.",
      },
      requiredShots: {
        type: "array",
        description:
          "가이드가 요구하는 필수 촬영 컷별 충족 여부. 가이드에 필수 컷 요구가 전혀 없으면 빈 배열.",
        items: {
          type: "object",
          properties: {
            requirement: { type: "string", description: "가이드에 적힌 필수 컷 요구를 짧게 (예: 제품 단독컷)" },
            status: {
              type: "string",
              enum: ["MATCHED", "CANDIDATE", "NOT_FOUND"],
              description:
                "MATCHED=분명히 그 컷인 사진이 있음, CANDIDATE=비슷하지만 확신할 수 없음, NOT_FOUND=해당하는 사진이 없음",
            },
            photoIds: { type: "array", items: { type: "string" }, description: "해당 컷으로 판단한 photoId (NOT_FOUND면 빈 배열)" },
            note: { type: "string", description: "판단 근거나 재촬영 안내를 한 문장으로" },
          },
          required: ["requirement", "status", "photoIds", "note"],
        },
      },
      groups: {
        type: "array",
        description: "설명이 거의 같은 중복/유사 사진 묶음. 유사한 사진이 없으면 빈 배열.",
        items: {
          type: "object",
          properties: {
            photoIds: { type: "array", items: { type: "string" }, description: "서로 비슷한 photoId 2개 이상" },
            keepPhotoId: { type: "string", description: "이 묶음에서 쓰기를 추천하는 photoId" },
            reason: { type: "string", description: "왜 비슷하다고 봤는지 한 문장으로" },
          },
          required: ["photoIds", "keepPhotoId", "reason"],
        },
      },
      reasons: {
        type: "array",
        description: "전달받은 모든 사진 각각에 대한 짧은 이유와 역할 태그",
        items: {
          type: "object",
          properties: {
            photoId: { type: "string" },
            reason: { type: "string", description: "추천/미추천 이유를 25자 내외 한국어 한 문장으로" },
            role: { type: "string", enum: PHOTO_SELECT_ROLES },
          },
          required: ["photoId", "reason", "role"],
        },
      },
    },
    required: ["selectedPhotoIds", "coverCandidateIds", "requiredShots", "groups", "reasons"],
  },
};

export type PhotoSelectResponse = {
  selectedPhotoIds: string[];
  coverCandidateIds: string[];
  requiredShots: { requirement: string; status: string; photoIds: string[]; note: string }[];
  groups: { photoIds: string[]; keepPhotoId: string; reason: string }[];
  reasons: { photoId: string; reason: string; role: string }[];
};

export function buildPhotoSelectPrompt(input: PhotoSelectInput) {
  const systemPrompt = [
    "너는 인플루언서가 협찬 콘텐츠에 실제로 사용할 사진을 골라주는 어시스턴트다.",
    NO_FABRICATION_RULE,
    "",
    "## 절대 규칙",
    "1. photoId는 아래 '사진 목록'에 실제로 있는 id만 써라. 없는 id를 새로 만들어내면 안 된다.",
    "2. 사용자가 '꼭 사용'으로 지정한 사진은 무조건 selectedPhotoIds에 포함하라.",
    "3. 사용자가 '제외'로 지정한 사진은 어떤 필드에도 절대 넣지 마라.",
    "4. 가이드가 요구하는 필수 컷에 해당하는 사진이 실제로 없으면 status를 NOT_FOUND로 정직하게 보고하라. 애매한 사진을 억지로 끼워 맞춰 MATCHED로 만들지 마라. 비슷하지만 확신이 없으면 CANDIDATE다.",
    "5. 사진에 실제로 보이는 내용(AI 분석 설명)과 사용자 메모, 가이드에 적힌 내용만 근거로 삼아라. 사진에 없는 장면·효과·반응을 상상해서 이유로 쓰지 마라.",
    "6. 사람의 외모·매력도·나이·성별·인종 등 사람 자체에 대한 평가나 추정은 절대 하지 마라. 구도, 초점, 제품이 잘 보이는지, 어떤 장면인지 같은 내용/구성 차원만 판단하라.",
    "",
    "## 어떻게 고르는가",
    "- 후기 콘텐츠 흐름(대표/완성컷 → 패키지 → 구성 → 제품 단독 → 디테일 → 실제 사용 → 결과)에 필요한 역할을 골고루 채우는 걸 우선하라.",
    "- 설명이 거의 같은 사진이 여러 장이면 그 중 가장 잘 보이는 한 장만 selectedPhotoIds에 넣고, 나머지는 groups로 묶어서 알려라.",
    "- 사진 설명에 흐릿함/어두움/피사체가 잘려 있음 같은 문제가 드러나면 추천에서 빼고 reason에 그 이유를 적어라. 설명만으로는 알 수 없는 화질 문제를 추측해서 단정하지는 마라.",
    "- 모든 사진을 다 쓸 필요는 없다. 다만 가이드의 최소 사진 수가 있으면 그 이상은 추천하라.",
    "- 사용자가 입력한 실제 사용 경험이 있으면, 그 경험을 뒷받침하는 장면의 사진을 우선하라. 경험 입력이 비어 있으면 억지로 사용 장면을 추천 이유로 지어내지 마라.",
    "- reasons에는 추천한 사진과 추천하지 않은 사진 모두를 포함하라.",
    "",
    "결과는 submit_photo_selection 도구를 호출해서 제출하라.",
  ].join("\n");

  const guideLines: string[] = [];
  const a = input.guideAnalysis;
  if (a) {
    if (a.minimumPhotos) guideLines.push(`최소 사진 수: ${a.minimumPhotos}장`);
    if (a.requiresVideo) guideLines.push("영상 필수: 예");
    if (a.requiredPoints.length > 0) guideLines.push(`반드시 다뤄야 할 포인트: ${a.requiredPoints.join(" / ")}`);
    if (a.otherRequirements.length > 0) guideLines.push(`기타 요구사항: ${a.otherRequirements.join(" / ")}`);
  } else if (input.minimumPhotos) {
    guideLines.push(`최소 사진 수: ${input.minimumPhotos}장`);
  }

  const reviewLines = (Object.keys(REVIEW_NOTE_LABELS) as (keyof ReviewNotes)[])
    .filter((key) => input.reviewNotes[key]?.trim())
    .map((key) => `${REVIEW_NOTE_LABELS[key]}: ${input.reviewNotes[key]}`);

  const photoLines = input.photos
    .map(
      (p) =>
        `- photoId: ${p.id} | 업로드순서: ${p.position} | 유형: ${p.photoType ?? "미분류"}${
          p.hasEdit ? " | 보정본 있음" : ""
        } | AI 분석: ${p.description}${p.memo ? ` | 사용자 메모: ${p.memo}` : ""}`,
    )
    .join("\n");

  const promptParts = [
    "## 협찬 정보",
    `브랜드: ${input.brandName}`,
    `제품명: ${input.productName}`,
    "",
    "## 업체 가이드라인 원문 (필수 촬영 컷 요구가 있으면 여기서 찾아라)",
    input.guideRawContent?.trim() ? input.guideRawContent : "(없음)",
    "",
    "## 가이드 구조화 분석 결과",
    guideLines.length > 0 ? guideLines.join("\n") : "(없음)",
    "",
    "## 사용자가 입력한 실제 사용 경험",
    reviewLines.length > 0 ? reviewLines.join("\n") : "(없음 — 경험 기반 이유를 지어내지 마라)",
    "",
    "## 사진 목록 (이 id들만 사용 가능)",
    photoLines || "(없음)",
    "",
    "## 사용자가 '꼭 사용'으로 지정한 사진 (무조건 포함)",
    input.pinnedPhotoIds.length > 0 ? input.pinnedPhotoIds.join(", ") : "(없음)",
    "",
    "## 사용자가 '제외'로 지정한 사진 (절대 포함 금지, 위 목록에서도 제거됨)",
    input.excludedPhotoIds.length > 0 ? input.excludedPhotoIds.join(", ") : "(없음)",
    "",
    "위 정보를 바탕으로 실제로 사용할 사진을 추천해줘.",
  ];

  return { systemPrompt, prompt: promptParts.join("\n"), responseSchema: photoSelectSchema };
}
