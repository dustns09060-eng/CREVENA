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
  | "GUIDE_ANALYZE";

export const OPERATION_CREDIT_COST: Record<AiOperation, number> = {
  CONTENT_GENERATE: 1,
  PHOTO_ANALYSIS: 1,
  ORDER_SUGGEST: 2,
  GUIDE_CHECK: 1,
  BLOG_WRITE: 10,
  PARAGRAPH_REGENERATE: 1,
  GUIDE_ANALYZE: 2,
};

export function creditLabel(operation: AiOperation): string {
  return `${OPERATION_CREDIT_COST[operation]} 크레딧 사용`;
}
