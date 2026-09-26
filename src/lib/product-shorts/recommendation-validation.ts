// Server-side validation for the AI photo-recommendation response (§5/§14 of
// the Phase 4 spec). Alias resolution happens here: any unknown/malformed
// alias is a hard failure (never silently dropped), so the caller can refund
// ORDER_SUGGEST and refuse to persist.

import { resolveAlias } from "./photo-alias";
import {
  PRODUCT_SHORTS_PHOTO_ROLES,
  type PhotoRecommendationRun,
  type ProductShortsPhotoRole,
} from "./recommendation-types";

type RawRecommendation = {
  selectedIds?: unknown;
  coverCandidateIds?: unknown;
  excludedIds?: unknown;
  missingShots?: unknown;
  reasons?: unknown;
};

export type RecommendationValidationResult =
  | { ok: true; run: PhotoRecommendationRun }
  | { ok: false; error: string };

function isRole(value: unknown): value is ProductShortsPhotoRole {
  return typeof value === "string" && (PRODUCT_SHORTS_PHOTO_ROLES as readonly string[]).includes(value);
}

export function validateRecommendationResponse(
  raw: unknown,
  aliasToUuid: Map<string, string>,
  consideredMediaIds: string[],
): RecommendationValidationResult {
  if (!raw || typeof raw !== "object") return { ok: false, error: "AI 응답 형식이 올바르지 않습니다." };
  const r = raw as RawRecommendation;

  const resolveList = (ids: unknown): string[] | null => {
    if (!Array.isArray(ids)) return null;
    const out: string[] = [];
    for (const alias of ids) {
      const uuid = resolveAlias(alias, aliasToUuid);
      if (!uuid) return null; // unknown/malformed alias -> whole response fails
      out.push(uuid);
    }
    return out;
  };

  const selectedMediaIds = resolveList(r.selectedIds);
  if (selectedMediaIds === null) return { ok: false, error: "추천 결과에 알 수 없는 사진 id가 포함되어 있습니다." };

  const coverCandidateIds = resolveList(r.coverCandidateIds);
  if (coverCandidateIds === null) return { ok: false, error: "대표 이미지 후보에 알 수 없는 사진 id가 포함되어 있습니다." };

  const excludedMediaIds = resolveList(r.excludedIds);
  if (excludedMediaIds === null) return { ok: false, error: "제외 목록에 알 수 없는 사진 id가 포함되어 있습니다." };

  const selectedSet = new Set(selectedMediaIds);
  if (!coverCandidateIds.every((id) => selectedSet.has(id))) {
    return { ok: false, error: "대표 이미지 후보가 추천 사진 목록에 없습니다." };
  }

  if (!Array.isArray(r.missingShots) || !r.missingShots.every((s) => typeof s === "string")) {
    return { ok: false, error: "AI 응답 형식이 올바르지 않습니다 (missingShots)." };
  }

  if (!Array.isArray(r.reasons)) return { ok: false, error: "AI 응답 형식이 올바르지 않습니다 (reasons)." };
  const reasons: PhotoRecommendationRun["reasons"] = [];
  for (const item of r.reasons) {
    if (!item || typeof item !== "object") return { ok: false, error: "AI 응답 형식이 올바르지 않습니다 (reasons)." };
    const entry = item as { id?: unknown; reason?: unknown; role?: unknown };
    const uuid = resolveAlias(entry.id, aliasToUuid);
    if (!uuid) return { ok: false, error: "추천 이유에 알 수 없는 사진 id가 포함되어 있습니다." };
    if (typeof entry.reason !== "string" || !isRole(entry.role)) {
      return { ok: false, error: "AI 응답 형식이 올바르지 않습니다 (reasons)." };
    }
    reasons.push({ mediaId: uuid, reason: entry.reason, role: entry.role });
  }

  return {
    ok: true,
    run: {
      generatedAt: new Date().toISOString(),
      consideredMediaIds,
      selectedMediaIds,
      coverCandidateIds,
      excludedMediaIds,
      missingShots: r.missingShots as string[],
      reasons,
    },
  };
}
