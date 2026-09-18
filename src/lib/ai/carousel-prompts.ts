import type { ResponseSchema } from "./types";
import type { ReviewNotes, StyleSample } from "./prompts";
import { NO_FABRICATION_RULE, REVIEW_NOTE_LABELS, parseJsonResponse } from "./photo-blog-prompts";

export { parseJsonResponse };

// ---------------------------------------------------------------------------
// STEP41 item 4/5/6: card composition. One call turns guide + photo analyses
// + reviewNotes into an ordered card list (role/headline/body/photo), reusing
// the exact same three-source no-fabrication rule as the blog/Reels writers.
// Unlike ReelsMediaSummary, carousel media is photos only — no video, since
// V1 explicitly scopes carousel to the existing photo library.
// ---------------------------------------------------------------------------
export type CarouselPhotoSummary = {
  id: string;
  description: string; // collaboration_photos.ai_analysis — never fabricated if null (see buildCarouselPlanPrompt)
};

export type CarouselPlanInput = {
  brandName: string;
  productName: string;
  requiredKeywords?: string | null;
  requiredHashtags?: string | null;
  contentGuide?: string | null;
  guideRawContent?: string | null;
  reviewNotes: ReviewNotes;
  styleSamples?: StyleSample[];
  photos: CarouselPhotoSummary[];
  // STEP42: "이 글로 카드뉴스 만들기" — when repurposing from an already
  // written Blog, its full text is handed over as an extra source the model
  // must draw its hook/feature/experience text from (still only ever
  // matching cards to photos by ai_analysis, never by paragraph order).
  sourceBlogText?: string;
};

const CAROUSEL_ROLES = ["cover", "product", "detail", "usage", "feature", "experience", "closing"] as const;

export const carouselPlanSchema: ResponseSchema = {
  name: "submit_carousel_plan",
  description: "인스타그램 카드뉴스(캐러셀) 구성안을 제출한다.",
  schema: {
    type: "object",
    properties: {
      cards: {
        type: "array",
        description:
          "추천하는 카드 순서. photos 배열에 있는 id만 사용할 것 — 새 id를 지어내지 말 것. 사진 수와 실제 내용이 부족하면 5장보다 적게 만들어도 된다 — 억지로 5~10장을 채우지 마라.",
        items: {
          type: "object",
          properties: {
            photoId: { type: "string" },
            role: { type: "string", enum: [...CAROUSEL_ROLES] },
            headline: { type: "string", description: "짧은 헤드라인 한 줄 (15자 내외)" },
            body: {
              type: "string",
              description: "본문 1~2문장. 사진관찰사실/사용자입력경험/업체가이드객관정보 중 하나로만 뒷받침되는 내용만.",
            },
          },
          required: ["photoId", "role", "headline", "body"],
        },
      },
    },
    required: ["cards"],
  },
};

export function buildCarouselPlanPrompt(input: CarouselPlanInput) {
  const systemPrompt = [
    "너는 체험단/협찬 인플루언서의 Instagram 카드뉴스(캐러셀) 구성안을 짜는 어시스턴트다.",
    NO_FABRICATION_RULE,
    "headline과 body는 화면에 표시할 짧은 텍스트다 — 블로그 문단처럼 길게 쓰지 마라.",
    "\"아이가 좋아했어요\", \"효과를 느꼈어요\", \"재구매 예정\", \"흡수가 빨랐어요\" 같은 감정/효과/의향 표현은",
    "사용자입력경험에 실제로 없으면 절대 쓰지 마라. 사진을 보고 감정이나 효과를 추측하지 마라.",
    "카드는 기본적으로 5~10장이 자연스럽지만, 사진 수나 실제 내용이 부족하면 억지로 채우지 말고 그보다 적게 만들어라.",
    "photos 배열에 주어진 사진만 카드로 쓸 수 있다. 특별한 이유 없이 같은 사진을 여러 카드에 반복해서 쓰지 마라.",
    "가능하면 대표성이 가장 큰 사진을 role:\"cover\"인 첫 카드로 골라라.",
    "자연스러운 순서(cover → product/detail → usage → feature/experience → closing)로 배열하되, 실제 내용에 맞지 않으면 role을 억지로 다 채우지 않아도 된다.",
    input.sourceBlogText
      ? "아래 '원본 블로그 글'이 주어져 있다 — 이 블로그에 실제로 있는 사실/경험만 headline/body에 재사용하라. 블로그 문단 순서를 그대로 따라가지 말고, photos의 사진 내용(ai_analysis)과 가장 잘 맞는 카드에 배치하라. 블로그에 없는 새로운 경험/효과/감정을 추가하거나 블로그 문장의 의미를 더 강하게 확대하지 마라."
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const guideLines: string[] = [`브랜드: ${input.brandName}`, `제품명: ${input.productName}`];
  if (input.requiredKeywords) guideLines.push(`필수 키워드: ${input.requiredKeywords}`);
  if (input.requiredHashtags) guideLines.push(`필수 해시태그: ${input.requiredHashtags}`);
  if (input.contentGuide) guideLines.push(`가이드 요약: ${input.contentGuide}`);
  if (input.guideRawContent) guideLines.push(`브랜드 가이드라인 원문:\n${input.guideRawContent}`);

  const reviewLines = (Object.keys(REVIEW_NOTE_LABELS) as (keyof ReviewNotes)[])
    .filter((key) => input.reviewNotes[key]?.trim())
    .map((key) => `${REVIEW_NOTE_LABELS[key]}: ${input.reviewNotes[key]}`);

  const photoLines = input.photos.map((p) => `- id: ${p.id} | 내용: ${p.description}`);

  const promptParts = [
    "## 협찬 정보",
    guideLines.join("\n"),
    "",
    "## 사용자가 입력한 후기 메모",
    reviewLines.length > 0 ? reviewLines.join("\n") : "(없음)",
    ...(input.sourceBlogText ? ["", "## 원본 블로그 글", input.sourceBlogText] : []),
    "",
    "## 사용 가능한 사진",
    photoLines.join("\n"),
    "",
    "Instagram 카드뉴스 구성안을 제출하라.",
  ];

  return { systemPrompt, prompt: promptParts.join("\n"), responseSchema: carouselPlanSchema };
}
