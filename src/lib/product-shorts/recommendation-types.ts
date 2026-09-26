// Product Shorts' own photo-recommendation state — NOT collaborations.photo_select
// (explicitly not reused, per instruction) and not a new table/migration.
// Persisted inside product_shorts_projects.reels_project as a
// ProductShortsGenerationState (see persist.ts for why that column, despite
// its name, is the right place — no new migration was needed).

export const PRODUCT_SHORTS_PHOTO_ROLES = [
  "COVER", // 대표 상품컷
  "PACKAGE", // 패키지컷
  "DETAIL", // 디테일컷
  "USAGE", // 사용/연출컷
  "FEATURE", // 특징 설명컷
  "CTA", // CTA용 컷
  "OTHER",
] as const;
export type ProductShortsPhotoRole = (typeof PRODUCT_SHORTS_PHOTO_ROLES)[number];

export type PhotoRecommendationReason = {
  mediaId: string;
  reason: string;
  role: ProductShortsPhotoRole;
};

// One AI recommendation run's raw result, already alias-resolved to real
// mediaIds and validated against the real photo set. Distinct from
// PhotoFinalSelection below — the user's actual choice, which the AI's
// recommendation never overrides.
export type PhotoRecommendationRun = {
  generatedAt: string;
  consideredMediaIds: string[];
  selectedMediaIds: string[];
  coverCandidateIds: string[];
  excludedMediaIds: string[];
  missingShots: string[]; // "필요한데 없는 컷" — free-text notes, never a fabricated photo
  reasons: PhotoRecommendationReason[];
};

// The user's actual final choice — always authoritative over the AI's
// recommendation, mirroring STEP47 Photo Select's own absolute rule
// (excluded > pinned > included > AI 추천 > everything else), reimplemented
// here for Product Shorts' own media set rather than reusing photo-select.ts.
export type PhotoFinalSelection = {
  pinnedIds: string[];
  excludedIds: string[];
  includedIds: string[]; // ordered — this order is what scene composition uses
  coverMediaId: string | null;
};

export function sanitizeFinalSelection(
  raw: Partial<PhotoFinalSelection> | null | undefined,
  realMediaIds: Set<string>,
): PhotoFinalSelection {
  const clean = (ids: unknown): string[] =>
    Array.isArray(ids) ? [...new Set(ids.filter((id): id is string => typeof id === "string" && realMediaIds.has(id)))] : [];

  const excludedIds = clean(raw?.excludedIds);
  const excludedSet = new Set(excludedIds);
  const pinnedIds = clean(raw?.pinnedIds).filter((id) => !excludedSet.has(id));
  const includedIds = clean(raw?.includedIds).filter((id) => !excludedSet.has(id));
  // pinned ids must appear in includedIds even if the caller forgot them.
  const includedSet = new Set(includedIds);
  for (const id of pinnedIds) {
    if (!includedSet.has(id)) includedIds.push(id);
  }
  const coverMediaId =
    typeof raw?.coverMediaId === "string" && realMediaIds.has(raw.coverMediaId) && !excludedSet.has(raw.coverMediaId)
      ? raw.coverMediaId
      : null;

  return { pinnedIds, excludedIds, includedIds, coverMediaId };
}

export type ProductShortsGenerationState = {
  version: 1;
  recommendation: PhotoRecommendationRun | null;
  selection: PhotoFinalSelection;
  plan: import("@/app/(app)/collaborations/[id]/reels/actions").ReelsProject | null;
};

export function emptyGenerationState(): ProductShortsGenerationState {
  return {
    version: 1,
    recommendation: null,
    selection: { pinnedIds: [], excludedIds: [], includedIds: [], coverMediaId: null },
    plan: null,
  };
}
