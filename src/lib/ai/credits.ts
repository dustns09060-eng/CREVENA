// Single source of truth for how many AI credits each operation costs.
// These are placeholder values (per STEP24 request) — change them here only;
// nothing else should hardcode a credit number.
//
// Which operations get their own dedicated API route (and therefore a
// server-fixed credit cost the client cannot influence) vs. share the
// generic /api/ai/generate route is explained in each route file.
export type AiOperation =
  | "CONTENT_GENERATE"
  | "PHOTO_ANALYSIS"
  | "ORDER_SUGGEST"
  | "GUIDE_CHECK"
  | "BLOG_WRITE"
  | "PARAGRAPH_REGENERATE"
  // STEP35.5: extracts the structured guide (keywords, minimum photo/char
  // counts, required phrases, etc.) from pasted brand guideline text. A new
  // capability, not a repricing of anything above — every existing cost is
  // unchanged.
  | "GUIDE_ANALYZE"
  // STEP37 item 2: patches in missing structural guide items (keywords,
  // required phrase, hashtags, account tags, min length) without touching
  // anything experience-based. Same cost class as PARAGRAPH_REGENERATE — a
  // targeted text patch, not a full rewrite.
  | "GUIDE_AUTOFIX"
  // STEP39: one vision call per video, analyzing 2-3 extracted representative
  // frames together (never the raw video) — same cost class as PHOTO_ANALYSIS
  // but priced slightly higher since it's 2-3 images in one call, not one.
  | "VIDEO_FRAME_ANALYZE"
  // STEP39: the reels scene-composition call — guide + photo analyses +
  // video frame analyses + reviewNotes in, an ordered scene list with
  // captions out. Priced like a mid-size single text generation (below
  // BLOG_WRITE, since reels captions are short lines, not full paragraphs),
  // not per-scene, so re-running it doesn't scale with scene count.
  | "REELS_PLAN"
  // STEP41: the carousel card-composition call — same input shape/cost class
  // as REELS_PLAN (guide + photo analyses + reviewNotes in, an ordered
  // card list with headline/body out), reusing no photo re-analysis and no
  // per-card charge. PNG rendering itself is free (client-side canvas, no AI
  // call, no server compute — see the STEP41 report).
  | "CAROUSEL_PLAN";

export const OPERATION_CREDIT_COST: Record<AiOperation, number> = {
  CONTENT_GENERATE: 1,
  PHOTO_ANALYSIS: 1,
  ORDER_SUGGEST: 2,
  GUIDE_CHECK: 1,
  BLOG_WRITE: 10,
  PARAGRAPH_REGENERATE: 1,
  GUIDE_ANALYZE: 2,
  GUIDE_AUTOFIX: 1,
  VIDEO_FRAME_ANALYZE: 2,
  REELS_PLAN: 5,
  CAROUSEL_PLAN: 5,
};

export function creditLabel(operation: AiOperation): string {
  return `${OPERATION_CREDIT_COST[operation]} 크레딧 사용`;
}
