// Server-side validation for the AI scene-composition (Plan) response (§14).
// Produces a ReelsScene[] compatible with the existing collaborations/reels
// ReelsScene type — reused verbatim so a future ReelsStudio/MP4 integration
// (out of scope for this phase) can consume it without another shape change.

import { resolveAlias } from "./photo-alias";
import type { ReelsScene } from "@/app/(app)/collaborations/[id]/reels/actions";

type RawPlan = {
  scenes?: unknown;
  hook?: unknown;
  ctaText?: unknown;
};

export type PlanValidationResult =
  | { ok: true; scenes: ReelsScene[]; hook: string; ctaText: string }
  | { ok: false; error: string };

const DURATION_TOLERANCE_SECONDS = 2;

export function validateProductShortsPlan(
  raw: unknown,
  aliasToUuid: Map<string, string>,
  finalSelectedMediaIds: Set<string>,
  targetDurationSeconds: 15 | 30,
): PlanValidationResult {
  if (!raw || typeof raw !== "object") return { ok: false, error: "AI 응답 형식이 올바르지 않습니다." };
  const r = raw as RawPlan;

  if (typeof r.hook !== "string" || typeof r.ctaText !== "string") {
    return { ok: false, error: "AI 응답 형식이 올바르지 않습니다 (hook/ctaText)." };
  }
  if (!Array.isArray(r.scenes) || r.scenes.length === 0) {
    return { ok: false, error: "장면 구성이 비어 있습니다." };
  }

  const scenes: ReelsScene[] = [];
  let totalDuration = 0;

  for (let i = 0; i < r.scenes.length; i++) {
    const item = r.scenes[i];
    if (!item || typeof item !== "object") return { ok: false, error: "AI 응답 형식이 올바르지 않습니다 (scenes)." };
    const entry = item as { mediaId?: unknown; durationSeconds?: unknown; caption?: unknown };

    const mediaId = resolveAlias(entry.mediaId, aliasToUuid);
    if (!mediaId) return { ok: false, error: "장면 구성에 알 수 없는 사진 id가 포함되어 있습니다." };
    if (!finalSelectedMediaIds.has(mediaId)) {
      return { ok: false, error: "장면 구성에 최종 선택되지 않은 사진이 포함되어 있습니다." };
    }
    if (typeof entry.durationSeconds !== "number" || !Number.isFinite(entry.durationSeconds) || entry.durationSeconds <= 0) {
      return { ok: false, error: "장면 구성의 길이 값이 올바르지 않습니다." };
    }
    if (typeof entry.caption !== "string") {
      return { ok: false, error: "AI 응답 형식이 올바르지 않습니다 (caption)." };
    }

    totalDuration += entry.durationSeconds;
    scenes.push({
      id: `${i}-photo:${mediaId}`,
      mediaType: "photo",
      mediaId,
      included: true,
      durationSeconds: entry.durationSeconds,
      caption: entry.caption,
      captionVisible: entry.caption.trim() !== "",
    });
  }

  if (Math.abs(totalDuration - targetDurationSeconds) > DURATION_TOLERANCE_SECONDS) {
    return {
      ok: false,
      error: `장면 길이 합(${totalDuration.toFixed(1)}초)이 목표 길이(${targetDurationSeconds}초)와 너무 차이가 납니다.`,
    };
  }

  return { ok: true, scenes, hook: r.hook, ctaText: r.ctaText };
}
