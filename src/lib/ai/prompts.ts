export type ContentPlatformKey = "INSTAGRAM_FEED" | "NAVER_BLOG" | "THREADS";

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
  const lines = [
    `브랜드: ${input.brandName}`,
    `제품명: ${input.productName}`,
  ];
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
  return samples
    .map((s) => `[${s.styleName}]\n${s.sampleText.slice(0, 800)}`)
    .join("\n\n");
}

function formatReviewNotes(notes: ReviewNotes) {
  const lines = (Object.keys(REVIEW_NOTE_LABELS) as (keyof ReviewNotes)[])
    .filter((key) => notes[key]?.trim())
    .map((key) => `${REVIEW_NOTE_LABELS[key]}: ${notes[key]}`);
  return lines.length > 0 ? lines.join("\n") : "(사용자가 입력한 후기 메모 없음)";
}

const PLATFORM_INSTRUCTIONS: Record<ContentPlatformKey, string> = {
  INSTAGRAM_FEED: [
    "Instagram Feed 게시글을 작성하라.",
    "순서: 광고 표시 → 자연스러운 시작 → 실사용 경험 → 제품 장점 → 사용 후기 → 추천 포인트 → 해시태그.",
    "문장은 지나치게 광고처럼 느껴지지 않도록 자연스럽게 작성하라.",
    "마지막 줄에 필수 해시태그를 포함한 해시태그 목록을 작성하라.",
  ].join("\n"),
  NAVER_BLOG: [
    "네이버 블로그 포스트를 작성하라.",
    "구조: 제목 → 도입부 → 제품 소개 → 사용하게 된 이유 → 실사용 후기 → 장점 → 사용 모습 → 추천 대상 → 마무리 → 해시태그.",
    "필수 키워드가 있다면 본문에 자연스럽게 여러 번 반복해서 포함하라.",
    "제목은 첫 줄에 작성하라.",
  ].join("\n"),
  THREADS: [
    "Threads 게시글을 작성하라.",
    "블로그나 Instagram보다 짧고 훨씬 더 자연스럽고 일상적인 말투로 작성하라.",
    "친근한 말투, 짧은 문장을 사용하고 광고 문구는 최소화하라.",
  ].join("\n"),
};

export function buildContentPrompt(
  platform: ContentPlatformKey,
  input: ContentGenerationInput,
) {
  const styleSamplesText = formatStyleSamples(input.styleSamples);
  const styleInstruction = styleSamplesText
    ? "아래 '내 글 스타일 예시'와 비슷한 말투, 문장 습관, 어조로 작성하라. 예시의 내용을 그대로 베끼지는 마라."
    : null;

  const systemPrompt = [COMMON_RULES, styleInstruction, PLATFORM_INSTRUCTIONS[platform]]
    .filter(Boolean)
    .join("\n\n");

  const promptParts = [
    "## 협찬 정보",
    formatCollaborationInfo(input),
    "",
    "## 사용자가 입력한 후기 메모",
    formatReviewNotes(input.reviewNotes),
  ];

  if (styleSamplesText) {
    promptParts.push("", "## 내 글 스타일 예시", styleSamplesText);
  }

  promptParts.push("", "위 정보를 바탕으로 글을 작성해줘.");

  return { systemPrompt, prompt: promptParts.join("\n") };
}
