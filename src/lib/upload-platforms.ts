export const UPLOAD_PLATFORM_LABELS: Record<string, string> = {
  INSTAGRAM_FEED: "Instagram Feed",
  INSTAGRAM_REELS: "Instagram Reels",
  NAVER_BLOG: "Naver Blog",
  // STEP46: 네이버 클립(숏폼). CREVENA는 클립을 자동 업로드하지 않는다 —
  // 영상/게시 문구를 만들어 주고, 업로드는 사용자가 네이버 앱에서 직접 한다.
  NAVER_CLIP: "네이버 클립",
  THREADS: "Threads",
};

export const UPLOAD_PLATFORMS = Object.keys(UPLOAD_PLATFORM_LABELS);
