// STEP42: "Source Content" repurposing. No new DB column — provenance is
// nested inside the target platform's own generation_input, exactly like the
// existing guideTextAtGeneration precedent (BlogMeta/ReelsProject/
// CarouselProject already snapshot guide text at generation time to detect
// staleness the same way). sourceSnapshot is an opaque string (the exact
// source text/JSON used at repurpose time) compared against the source's
// CURRENT state to detect "원본이 변경되었습니다" without ever auto-regenerating.
export type ContentSourcePlatform = "NAVER_BLOG" | "CAROUSEL";

export type ContentSourceMeta = {
  sourcePlatform: ContentSourcePlatform;
  sourceContentId: string;
  sourceGeneratedAt: string; // ISO timestamp
  sourceSnapshot: string;
};

export const SOURCE_PLATFORM_LABEL: Record<ContentSourcePlatform, string> = {
  NAVER_BLOG: "블로그",
  CAROUSEL: "카드뉴스",
};
