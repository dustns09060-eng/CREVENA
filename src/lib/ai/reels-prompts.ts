import type { ResponseSchema } from "./types";
import type { ReviewNotes, StyleSample } from "./prompts";
import { NO_FABRICATION_RULE, REVIEW_NOTE_LABELS, parseJsonResponse } from "./photo-blog-prompts";

export { parseJsonResponse };

// ---------------------------------------------------------------------------
// STEP39 item 6: video frame analysis. We never send the raw video to the
// model — the browser extracts 2-3 representative JPEG frames from each clip
// (see useMediaManager's extractFrames) and this reuses the exact same
// Vision analysis mechanism as photo analysis, just with multiple images in
// one call instead of one.
// ---------------------------------------------------------------------------
export const videoFrameAnalysisSchema: ResponseSchema = {
  name: "submit_video_frame_analysis",
  description: "영상에서 추출한 대표 프레임들을 분석해 각 장면이 무엇을 보여주는지 제출한다.",
  schema: {
    type: "object",
    properties: {
      frames: {
        type: "array",
        description: "입력된 프레임 순서와 동일한 순서로, 프레임마다 하나씩",
        items: {
          type: "object",
          properties: {
            description: { type: "string", description: "이 프레임에 실제로 보이는 내용을 1~2문장으로" },
          },
          required: ["description"],
        },
      },
      summary: { type: "string", description: "이 영상 클립 전체가 무엇을 보여주는 장면인지 1문장 요약" },
    },
    required: ["frames", "summary"],
  },
};

export function buildVideoFrameAnalysisPrompt(frameTimestamps: number[]) {
  const systemPrompt = [
    "너는 협찬 제품 영상 클립의 대표 프레임을 분석하는 어시스턴트다.",
    NO_FABRICATION_RULE,
    "각 프레임에 실제로 보이는 것만 설명하라. 소리나 대사는 알 수 없으니 언급하지 마라.",
  ].join("\n");
  const prompt = [
    `아래는 한 영상 클립에서 ${frameTimestamps.length}장 추출한 대표 프레임이다.`,
    `추출 시점(초): ${frameTimestamps.map((t) => t.toFixed(1)).join(", ")}`,
    "각 프레임이 실제로 보여주는 내용과, 이 클립 전체의 요약을 제출하라.",
  ].join("\n");
  return { systemPrompt, prompt, responseSchema: videoFrameAnalysisSchema };
}

// ---------------------------------------------------------------------------
// STEP39 item 7: scene composition. One call turns guide + photo analyses +
// video frame analyses + reviewNotes into an ordered scene list with
// marketing/description captions (type A captions only — see STEP39 item 10;
// speech-to-text captions are out of scope for V1). Reuses the exact
// three-source no-fabrication rule from the blog/Instagram/Threads writers.
// ---------------------------------------------------------------------------
export type ReelsMediaSummary = {
  id: string;
  mediaType: "photo" | "video";
  description: string; // photo: ai_analysis; video: frame_analysis summary (+ per-frame notes)
  durationSeconds?: number; // video only
};

export type ReelsPlanInput = {
  brandName: string;
  productName: string;
  requiredKeywords?: string | null;
  requiredHashtags?: string | null;
  contentGuide?: string | null;
  guideRawContent?: string | null;
  reviewNotes: ReviewNotes;
  styleSamples?: StyleSample[];
  targetDurationSeconds: 15 | 30 | 60;
  media: ReelsMediaSummary[];
};

export const reelsPlanSchema: ResponseSchema = {
  name: "submit_reels_plan",
  description: "릴스 장면 구성안을 제출한다.",
  schema: {
    type: "object",
    properties: {
      scenes: {
        type: "array",
        description: "추천하는 장면 순서. media 배열에 있는 id만 사용할 것 — 새 id를 지어내지 말 것.",
        items: {
          type: "object",
          properties: {
            mediaId: { type: "string" },
            durationSeconds: {
              type: "number",
              description: "이 장면 표시 시간(초). 사진은 1.5~3초, 영상은 클립 길이 이하 권장.",
            },
            caption: {
              type: "string",
              description: "화면에 표시할 짧은 자막 한 줄 (마케팅/설명용, 10~20자 내외)",
            },
          },
          required: ["mediaId", "durationSeconds", "caption"],
        },
      },
    },
    required: ["scenes"],
  },
};

export function buildReelsPlanPrompt(input: ReelsPlanInput) {
  const systemPrompt = [
    "너는 체험단/협찬 인플루언서의 짧은 세로형 릴스(Reels) 영상 구성안을 짜는 어시스턴트다.",
    NO_FABRICATION_RULE,
    "자막은 화면 설명/마케팅용 한 줄이다 — 실제 음성을 받아쓰는 것이 아니다.",
    "\"아이가 좋아했어요\", \"재구매 예정\" 같은 표현은 사용자입력경험에 실제로 없으면 쓰지 마라.",
    `전체 영상 길이는 목표 ${input.targetDurationSeconds}초에 최대한 맞춰라 (장면별 durationSeconds 합).`,
    "media 배열에 주어진 사진/영상만 장면으로 쓸 수 있다. 모든 미디어를 다 쓸 필요는 없다 — 목표 길이에 맞게 고르고, 자연스러운 순서(도입 → 제품/디테일 → 사용 → 마무리)로 배열하라.",
  ].join("\n");

  const guideLines: string[] = [`브랜드: ${input.brandName}`, `제품명: ${input.productName}`];
  if (input.requiredKeywords) guideLines.push(`필수 키워드: ${input.requiredKeywords}`);
  if (input.requiredHashtags) guideLines.push(`필수 해시태그: ${input.requiredHashtags}`);
  if (input.contentGuide) guideLines.push(`가이드 요약: ${input.contentGuide}`);
  if (input.guideRawContent) guideLines.push(`브랜드 가이드라인 원문:\n${input.guideRawContent}`);

  const reviewLines = (Object.keys(REVIEW_NOTE_LABELS) as (keyof ReviewNotes)[])
    .filter((key) => input.reviewNotes[key]?.trim())
    .map((key) => `${REVIEW_NOTE_LABELS[key]}: ${input.reviewNotes[key]}`);

  const mediaLines = input.media.map(
    (m) =>
      `- id: ${m.id} | 종류: ${m.mediaType === "photo" ? "사진" : "영상"}${
        m.durationSeconds ? ` (길이 ${m.durationSeconds.toFixed(1)}초)` : ""
      } | 내용: ${m.description}`,
  );

  const promptParts = [
    "## 협찬 정보",
    guideLines.join("\n"),
    "",
    "## 사용자가 입력한 후기 메모",
    reviewLines.length > 0 ? reviewLines.join("\n") : "(없음)",
    "",
    "## 사용 가능한 사진/영상",
    mediaLines.join("\n"),
    "",
    `목표 길이 ${input.targetDurationSeconds}초에 맞는 릴스 장면 구성안을 제출하라.`,
  ];

  return { systemPrompt, prompt: promptParts.join("\n"), responseSchema: reelsPlanSchema };
}
