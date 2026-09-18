import type { ContentPlatform } from "@/types/database";

// STEP46 side-fix: contents.platform 값을 표시하기 위한 라벨 맵.
//
// 이전에는 content-library가 UPLOAD_PLATFORM_LABELS(업로드 플랫폼 어휘)로
// contents.platform(콘텐츠 종류 어휘)을 라벨링해서, 두 어휘에 겹치지 않는
// REELS / CAROUSEL / NAVER_BLOG_TITLE / NAVER_BLOG_BODY /
// INSTAGRAM_REELS_CAPTION / INSTAGRAM_REELS_SUBTITLE / COMMENT_REPLY /
// DM_REPLY 가 전부 `?? platform` 폴백에 걸려 화면에 raw key 그대로
// ("REELS", "CAROUSEL" ...) 노출됐다. 두 어휘는 원래 별개이므로
// 합치지 않고, contents 쪽 전용 맵을 둔다.
//
// Record<ContentPlatform, string>(exhaustive)이므로 앞으로 ContentPlatform에
// 값을 추가하면 라벨을 채울 때까지 컴파일 에러가 난다 — 같은 종류의 누락이
// 다시 조용히 발생하지 않게 하려는 의도다.
export const CONTENT_PLATFORM_LABELS: Record<ContentPlatform, string> = {
  INSTAGRAM_FEED: "Instagram",
  INSTAGRAM_REELS_CAPTION: "Instagram 릴스 캡션",
  INSTAGRAM_REELS_SUBTITLE: "Instagram 릴스 자막",
  NAVER_BLOG_TITLE: "블로그 제목",
  NAVER_BLOG_BODY: "블로그 본문",
  NAVER_BLOG: "블로그",
  THREADS: "Threads",
  COMMENT_REPLY: "댓글 답변",
  DM_REPLY: "DM 답변",
  REELS: "Reels",
  CAROUSEL: "카드뉴스",
  NAVER_CLIP: "네이버 클립",
};

export function contentPlatformLabel(platform: string): string {
  return CONTENT_PLATFORM_LABELS[platform as ContentPlatform] ?? platform;
}
