import type { ResponseSchema } from "./types";

// STEP33: this file used to also generate NAVER_BLOG as plain text, but the
// unified 콘텐츠 제작실's "블로그" tab is exclusively the photo-based blog
// flow from STEP16 (src/lib/ai/photo-blog-prompts.ts) — sections tied to
// real photos, not a free-standing text blog. This file now only covers the
// two platforms that generate structured, field-editable text content.
export type ContentPlatformKey = "INSTAGRAM_FEED" | "THREADS";

export type ReviewNotes = {
  actualReview?: string;
  pros?: string;
  cons?: string;
  kidsReaction?: string;
  usageLocation?: string;
  usageSituation?: string;
  photoDescription?: string;
  personalExperience?: string;
};

export type StyleSample = {
  styleName: string;
  sampleText: string;
};

export type ContentGenerationInput = {
  brandName: string;
  productName: string;
  campaignName?: string | null;
  requiredKeywords?: string | null;
  requiredHashtags?: string | null;
  requiredMentions?: string | null;
  adDisclosureText?: string | null;
  contentGuide?: string | null;
  guideRawContent?: string | null;
  reviewNotes: ReviewNotes;
  styleSamples?: StyleSample[];
};

// Structured output shapes, persisted as-is into contents.generation_input
// so the editable UI (and each field's independent regenerate button) can
// be restored after a refresh instead of re-parsing the flattened body.
export type InstagramParts = { hook: string; body: string; cta: string; hashtags: string };
export type ThreadsParts = { posts: string[] };

export function assembleInstagramText(parts: InstagramParts): string {
  return [parts.hook, parts.body, parts.cta, parts.hashtags].filter((s) => s?.trim()).join("\n\n");
}

export function assembleThreadsText(parts: ThreadsParts): string {
  return parts.posts.filter((p) => p?.trim()).join("\n\n");
}

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

const COMMON_RULES = [
  "너는 인플루언서의 협찬 콘텐츠 작성을 돕는 어시스턴트다.",
  "아래 제공된 정보만 사용해서 글을 작성하라.",
  "제품이나 브랜드에 대해 사실이 아닌 내용, 제공되지 않은 효과나 스펙을 절대로 지어내지 마라.",
  "사용자가 입력하지 않은 후기 항목은 언급하지 마라.",
].join("\n");

function formatCollaborationInfo(input: ContentGenerationInput) {
  const lines = [`브랜드: ${input.brandName}`, `제품명: ${input.productName}`];
  if (input.campaignName) lines.push(`캠페인: ${input.campaignName}`);
  if (input.requiredKeywords) lines.push(`필수 키워드: ${input.requiredKeywords}`);
  if (input.requiredHashtags) lines.push(`필수 해시태그: ${input.requiredHashtags}`);
  if (input.requiredMentions) lines.push(`필수 계정 태그: ${input.requiredMentions}`);
  if (input.adDisclosureText) lines.push(`광고 표시 문구: ${input.adDisclosureText}`);
  if (input.contentGuide) lines.push(`콘텐츠 작성 가이드: ${input.contentGuide}`);
  if (input.guideRawContent) lines.push(`브랜드 가이드라인 원문:\n${input.guideRawContent}`);
  return lines.join("\n");
}

function formatStyleSamples(samples?: StyleSample[]) {
  if (!samples || samples.length === 0) return null;
  return samples.map((s) => `[${s.styleName}]\n${s.sampleText.slice(0, 800)}`).join("\n\n");
}

function formatReviewNotes(notes: ReviewNotes) {
  const lines = (Object.keys(REVIEW_NOTE_LABELS) as (keyof ReviewNotes)[])
    .filter((key) => notes[key]?.trim())
    .map((key) => `${REVIEW_NOTE_LABELS[key]}: ${notes[key]}`);
  return lines.length > 0 ? lines.join("\n") : "(사용자가 입력한 후기 메모 없음)";
}

function buildContextBlock(input: ContentGenerationInput, styleSamplesText: string | null) {
  const parts = [
    "## 협찬 정보",
    formatCollaborationInfo(input),
    "",
    "## 사용자가 입력한 후기 메모",
    formatReviewNotes(input.reviewNotes),
  ];
  if (styleSamplesText) parts.push("", "## 내 글 스타일 예시", styleSamplesText);
  return parts;
}

const PLATFORM_STRUCTURE_INSTRUCTIONS: Record<ContentPlatformKey, string> = {
  INSTAGRAM_FEED: [
    "Instagram Feed 게시글을 4개 필드로 나눠서 작성하라.",
    "hook: 스크롤을 멈추게 할 첫 1~2줄. 궁금증을 유발하거나 공감을 얻는 문장.",
    "body: 자연스러운 실제 사용 경험과 핵심 장점, 가이드에 필수로 들어가야 할 내용(광고 표시 문구 포함) — 광고처럼 느껴지지 않게 자연스럽게.",
    "cta: 마지막 행동 유도 문장 (예: 저장하기, 더 궁금하면 댓글로).",
    "hashtags: 필수 해시태그를 포함한 해시태그 목록 (공백으로 구분).",
    "submit_instagram_post 도구를 호출해서 제출하라.",
  ].join("\n"),
  THREADS: [
    "Threads 게시글을 작성하라.",
    "Instagram이나 블로그를 그대로 복사하지 말고, Threads 특유의 짧고 대화체에 가까운 말투로 새로 써라.",
    "친근한 말투, 짧은 문장을 쓰고 광고 문구는 최소화하라.",
    "보통은 하나의 포스트(posts 배열에 항목 1개)로 충분하다. 내용이 자연스럽게 여러 개로 나뉘는 게 더 나을 때만(예: 쓰레드 형태의 이어말하기) 2~3개로 나눠라.",
    "각 포스트는 Threads 특성상 짧게(대략 2~4문장) 유지하라.",
    "submit_threads_post 도구를 호출해서 제출하라.",
  ].join("\n"),
};

// Forced tool-use schemas per platform (see ResponseSchema doc in types.ts) —
// this is what actually prevents the STEP34 "Expected ',' or '}'" failures:
// the API constrains the model's output to this shape before we ever see it,
// instead of us regexing a hoped-for JSON blob out of free text.
const CONTENT_RESPONSE_SCHEMAS: Record<ContentPlatformKey, ResponseSchema> = {
  INSTAGRAM_FEED: {
    name: "submit_instagram_post",
    description: "작성한 Instagram Feed 게시글을 4개 필드로 제출한다.",
    schema: {
      type: "object",
      properties: {
        hook: { type: "string" },
        body: { type: "string" },
        cta: { type: "string" },
        hashtags: { type: "string" },
      },
      required: ["hook", "body", "cta", "hashtags"],
    },
  },
  THREADS: {
    name: "submit_threads_post",
    description: "작성한 Threads 포스트 목록을 제출한다.",
    schema: {
      type: "object",
      properties: {
        posts: { type: "array", items: { type: "string" }, minItems: 1 },
      },
      required: ["posts"],
    },
  },
};

export function buildContentPrompt(platform: ContentPlatformKey, input: ContentGenerationInput) {
  const styleSamplesText = formatStyleSamples(input.styleSamples);
  const styleInstruction = styleSamplesText
    ? "아래 '내 글 스타일 예시'와 비슷한 말투, 문장 습관, 어조로 작성하라. 예시의 내용을 그대로 베끼지는 마라."
    : null;

  const systemPrompt = [COMMON_RULES, styleInstruction, PLATFORM_STRUCTURE_INSTRUCTIONS[platform]]
    .filter(Boolean)
    .join("\n\n");

  const promptParts = buildContextBlock(input, styleSamplesText);
  promptParts.push("", "위 정보를 바탕으로 글을 작성해줘.");

  return {
    systemPrompt,
    prompt: promptParts.join("\n"),
    responseSchema: CONTENT_RESPONSE_SCHEMAS[platform],
  };
}

// ---------------------------------------------------------------------------
// Partial regeneration: redo exactly one field without touching the rest.
// Still goes through the same 1-credit CONTENT_GENERATE-costed route as a
// full generation (see PARAGRAPH_REGENERATE in credits.ts) — no way to
// bypass the credit system by asking for "just one field" many times being
// any cheaper or more expensive than intended.
// ---------------------------------------------------------------------------
export type InstagramField = keyof InstagramParts;
export type RegenerateField =
  | { platform: "INSTAGRAM_FEED"; field: InstagramField; current: InstagramParts }
  | { platform: "THREADS"; field: "post"; postIndex: number; current: ThreadsParts };

const INSTAGRAM_FIELD_LABELS: Record<InstagramField, string> = {
  hook: "hook (첫 1~2줄 후킹 문구)",
  body: "body (실사용 경험/장점 본문)",
  cta: "cta (마지막 행동 유도 문장)",
  hashtags: "hashtags (해시태그 목록)",
};

export const fieldRegenerateSchema: ResponseSchema = {
  name: "submit_field_value",
  description: "다시 작성한 값 하나를 제출한다.",
  schema: {
    type: "object",
    properties: { value: { type: "string" } },
    required: ["value"],
  },
};

export function buildFieldRegeneratePrompt(
  target: RegenerateField,
  input: ContentGenerationInput,
): { systemPrompt: string; prompt: string; responseSchema: ResponseSchema } {
  const styleSamplesText = formatStyleSamples(input.styleSamples);
  const contextLines = buildContextBlock(input, styleSamplesText);

  if (target.platform === "INSTAGRAM_FEED") {
    const systemPrompt = [
      COMMON_RULES,
      `너는 이미 작성된 Instagram 게시글 중 "${INSTAGRAM_FIELD_LABELS[target.field]}" 부분만 다시 작성한다.`,
      "다른 필드는 그대로 두고 요청받은 필드 하나만 새로 작성하라. 나머지 필드와 자연스럽게 이어져야 한다.",
      "새로 작성한 값은 submit_field_value 도구를 호출해서 제출하라.",
    ].join("\n");
    const prompt = [
      ...contextLines,
      "",
      "## 현재 게시글 전체 (참고용, 이 중 요청받은 필드만 새로 작성)",
      `hook: ${target.current.hook}`,
      `body: ${target.current.body}`,
      `cta: ${target.current.cta}`,
      `hashtags: ${target.current.hashtags}`,
      "",
      `"${target.field}" 필드만 새로 작성해줘.`,
    ].join("\n");
    return { systemPrompt, prompt, responseSchema: fieldRegenerateSchema };
  }

  // THREADS post regenerate
  const systemPrompt = [
    COMMON_RULES,
    PLATFORM_STRUCTURE_INSTRUCTIONS.THREADS,
    "이미 작성된 여러 포스트 중 지정된 포스트 하나만 다시 작성하라. 다른 포스트는 그대로 두고 참고만 하라.",
    "새로 작성한 값은 submit_field_value 도구를 호출해서 제출하라.",
  ].join("\n");
  const prompt = [
    ...contextLines,
    "",
    "## 현재 전체 포스트 (참고용)",
    target.current.posts.map((p, i) => `${i + 1}. ${p}`).join("\n"),
    "",
    `${target.postIndex + 1}번째 포스트만 새로 작성해줘.`,
  ].join("\n");
  return { systemPrompt, prompt, responseSchema: fieldRegenerateSchema };
}
