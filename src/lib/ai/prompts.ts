import type { ResponseSchema } from "./types";
import type { ContentSourceMeta } from "@/lib/content-source";

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

// STEP42: a repurposed post stores sourceMeta alongside its normal parts in
// generation_input — kept as a separate wrapper type (rather than adding
// `sourceMeta` directly onto InstagramParts/ThreadsParts) because other code
// iterates `keyof InstagramParts`/`keyof ThreadsParts` assuming every field
// is a plain string (e.g. PlatformPanel's per-field regenerate buttons) —
// adding a non-string field there would break that. sourceMeta is optional
// and never produced by the AI itself (not part of either response schema
// below); the repurpose flow merges it in after parsing, right before saving.
export type WithSourceMeta<T> = T & { sourceMeta?: ContentSourceMeta };

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

// STEP36 item 12/13: same three-source rule as the photo-blog prompt (see
// NO_FABRICATION_RULE in photo-blog-prompts.ts) — writes can only draw on
// 사진관찰사실/사용자입력경험/업체가이드객관정보. Confirmed via a real test run that
// without this, the model invented child-reaction lines ("스스로 흔들어보려는
// 모습이 신기하기도...") even with empty review notes.
const COMMON_RULES = [
  "너는 인플루언서의 협찬 콘텐츠 작성을 돕는 어시스턴트다.",
  "아래 제공된 정보만 사용해서 글을 작성하라.",
  "제품이나 브랜드에 대해 사실이 아닌 내용, 제공되지 않은 효과나 스펙을 절대로 지어내지 마라.",
  "사용자가 입력하지 않은 후기 항목은 언급하지 마라.",
  "특히 아이/사람의 반응이나 감정(\"좋아했다\", \"신기해했다\", \"흥미를 보였다\" 등), 시간이 지나며",
  "나타난 변화나 효과(\"며칠 써보니 달라졌다\" 등), 앞으로의 의향(\"재구매할 예정이다\" 등)은",
  "사용자가 입력한 후기 메모에 실제로 그 내용이 있을 때만 써라. 후기 메모가 비어 있으면 이런 문장을",
  "아예 쓰지 말고, 제공된 협찬 정보(제품 사실)만으로 담백하게 서술하라 — 경험이 빈약해 보여도 절대로",
  "채워 넣지 마라.",
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

// ---------------------------------------------------------------------------
// STEP37 item 2: "AI로 보완" — patch in only the missing STRUCTURAL guide
// items (keywords/phrase/hashtags/account tags/min length) into an already
// generated post, changing as little else as possible. Reuses the exact
// per-platform response schema so the result plugs into the same setParts
// path as a full generate. The missing-item list passed in must already be
// filtered to autoFixable items by the caller — this function additionally
// repeats the no-fabrication rule so the model can't "solve" a length
// shortfall by inventing experience.
// ---------------------------------------------------------------------------
export function buildContentAutoFillPrompt(
  platform: ContentPlatformKey,
  current: InstagramParts | ThreadsParts,
  missingItems: { label: string; detail?: string }[],
  input: ContentGenerationInput,
): { systemPrompt: string; prompt: string; responseSchema: ResponseSchema } {
  const styleSamplesText = formatStyleSamples(input.styleSamples);
  const contextLines = buildContextBlock(input, styleSamplesText);

  const systemPrompt = [
    COMMON_RULES,
    "너는 이미 작성된 게시글에서 누락된 구조적 요구사항만 자연스럽게 보완하는 어시스턴트다.",
    "아래 '보완이 필요한 항목' 목록에 있는 것만 고쳐라 — 그 외 내용, 어조, 문장은 최대한 원문 그대로 유지하라.",
    "글자 수가 부족하면 사진관찰사실/사용자입력경험/업체가이드객관정보 중 아직 안 쓴 내용을 추가해서 늘려라. 없는 경험이나 반응, 효과, 시간 경과, 재구매 의사를 새로 지어내서 글자 수를 채우지 마라.",
    PLATFORM_STRUCTURE_INSTRUCTIONS[platform],
  ].join("\n");

  const currentText =
    platform === "INSTAGRAM_FEED"
      ? `hook: ${(current as InstagramParts).hook}\nbody: ${(current as InstagramParts).body}\ncta: ${(current as InstagramParts).cta}\nhashtags: ${(current as InstagramParts).hashtags}`
      : (current as ThreadsParts).posts.map((p, i) => `${i + 1}. ${p}`).join("\n");

  const promptParts = [
    ...contextLines,
    "",
    "## 현재 게시글",
    currentText,
    "",
    "## 보완이 필요한 항목",
    missingItems.map((m) => `- ${m.label}${m.detail ? ` (${m.detail})` : ""}`).join("\n"),
    "",
    "위 누락 항목만 자연스럽게 보완해서 게시글 전체를 다시 제출해줘.",
  ];

  return { systemPrompt, prompt: promptParts.join("\n"), responseSchema: CONTENT_RESPONSE_SCHEMAS[platform] };
}

// ---------------------------------------------------------------------------
// STEP42: "이 글로 인스타/Threads 만들기" — repurposes an already-generated
// Blog as the primary source instead of building from guide/reviewNotes
// alone. Reuses the exact same COMMON_RULES/PLATFORM_STRUCTURE_INSTRUCTIONS/
// CONTENT_RESPONSE_SCHEMAS/credit route (CONTENT_GENERATE, 1 credit via
// /api/ai/generate) as a normal from-scratch generation — repurposing isn't
// priced differently, it's the same "write one SNS post" operation with a
// richer source. The no-fabrication rule is restated with an explicit
// "don't amplify the Blog's wording" clause (STEP42 item 17) since the model
// now has a full finished draft in front of it, which is exactly the
// situation most likely to tempt it into "improving" a hedge into a claim.
// ---------------------------------------------------------------------------
export function buildRepurposeFromBlogPrompt(
  platform: ContentPlatformKey,
  sourceBlogText: string,
  input: ContentGenerationInput,
): { systemPrompt: string; prompt: string; responseSchema: ResponseSchema } {
  const styleSamplesText = formatStyleSamples(input.styleSamples);
  const styleInstruction = styleSamplesText
    ? "아래 '내 글 스타일 예시'와 비슷한 말투, 문장 습관, 어조로 작성하라. 예시의 내용을 그대로 베끼지는 마라."
    : null;

  const systemPrompt = [
    COMMON_RULES,
    "너는 이미 완성된 블로그 글을 재료로 삼아 다른 채널용 글로 다시 구성하는 어시스턴트다.",
    "블로그 원문을 그대로 잘라 붙이거나 앞부분만 잘라내지 말고, 이 채널에 맞는 길이/톤으로 새로 써라.",
    "블로그 원문에 실제로 있는 사실과 표현만 재사용하라 — 블로그에 없는 새로운 경험/효과/감정/재구매",
    "의사/아이 반응/사용 기간을 추가하지 마라.",
    "블로그 문장의 의미를 절대 더 강하게 확대하지 마라. 예를 들어 블로그에 \"촉촉하게 느껴졌다\"라고만",
    "쓰여 있다면 \"건조함이 완전히 해결됐다\" 같은 더 강한 효능 표현으로 바꾸지 마라.",
    styleInstruction,
    PLATFORM_STRUCTURE_INSTRUCTIONS[platform],
  ]
    .filter(Boolean)
    .join("\n\n");

  const promptParts = [
    "## 원본 블로그 글 (이 채널용으로 다시 구성할 재료)",
    sourceBlogText,
    "",
    ...buildContextBlock(input, styleSamplesText),
    "",
    "위 블로그 글의 내용을 재구성해서 새 글을 작성해줘.",
  ];

  return {
    systemPrompt,
    prompt: promptParts.join("\n"),
    responseSchema: CONTENT_RESPONSE_SCHEMAS[platform],
  };
}
