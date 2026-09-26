// Server-side validation of a Product Shorts plan edited in the studio.
// The client sends a whole ReelsProject; nothing in it is trusted. Only
// scenes that reference this project's own photos, with sane values, are
// accepted, and the stored project's other fields (publishCopy, hashtags,
// guideTextAtGeneration, ...) are preserved untouched rather than being
// overwritten by whatever the client sent.

import type { ReelsProject, ReelsScene, ReelsCaptionStyle } from "@/app/(app)/collaborations/[id]/reels/actions";

const MAX_SCENES = 30;
const MIN_DURATION = 0.5;
const MAX_DURATION = 60;
const MAX_CAPTION_LENGTH = 200;

const PRESETS = ["basic", "clean", "emphasis"] as const;
const POSITIONS = ["top", "middle", "bottom"] as const;
const SIZES = ["small", "medium", "large"] as const;

export function sanitizeCaptionStyle(raw: unknown, fallback: ReelsCaptionStyle): ReelsCaptionStyle {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof ReelsCaptionStyle, unknown>>;
  return {
    preset: (PRESETS as readonly unknown[]).includes(r.preset) ? (r.preset as ReelsCaptionStyle["preset"]) : fallback.preset,
    position: (POSITIONS as readonly unknown[]).includes(r.position) ? (r.position as ReelsCaptionStyle["position"]) : fallback.position,
    size: (SIZES as readonly unknown[]).includes(r.size) ? (r.size as ReelsCaptionStyle["size"]) : fallback.size,
  };
}

export function sanitizeEditedPlan(
  raw: unknown,
  stored: ReelsProject,
  projectTargetSeconds: 15 | 30,
  realMediaIds: Set<string>,
): { ok: true; plan: ReelsProject } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "저장할 내용이 올바르지 않아요." };
  const r = raw as { scenes?: unknown; captionStyle?: unknown };
  if (!Array.isArray(r.scenes) || r.scenes.length === 0 || r.scenes.length > MAX_SCENES) {
    return { ok: false, error: "장면 구성이 올바르지 않아요." };
  }

  const scenes: ReelsScene[] = [];
  const usedIds = new Set<string>();
  for (let i = 0; i < r.scenes.length; i++) {
    const s = r.scenes[i] as Partial<Record<keyof ReelsScene, unknown>> | null;
    if (!s || typeof s !== "object") return { ok: false, error: "장면 구성이 올바르지 않아요." };
    if (s.mediaType !== "photo") return { ok: false, error: "사진 장면만 저장할 수 있어요." };
    if (typeof s.mediaId !== "string" || !realMediaIds.has(s.mediaId)) {
      return { ok: false, error: "이 프로젝트의 사진이 아닌 장면이 포함되어 있어요." };
    }
    if (typeof s.durationSeconds !== "number" || !Number.isFinite(s.durationSeconds) || s.durationSeconds < MIN_DURATION || s.durationSeconds > MAX_DURATION) {
      return { ok: false, error: "장면 길이가 올바르지 않아요." };
    }
    if (typeof s.caption !== "string" || s.caption.length > MAX_CAPTION_LENGTH) {
      return { ok: false, error: "자막이 올바르지 않아요." };
    }
    if (typeof s.included !== "boolean" || typeof s.captionVisible !== "boolean") {
      return { ok: false, error: "장면 구성이 올바르지 않아요." };
    }
    let id = typeof s.id === "string" && s.id.length > 0 && s.id.length < 200 ? s.id : `${i}-photo:${s.mediaId}`;
    if (usedIds.has(id)) id = `${i}-photo:${s.mediaId}`;
    usedIds.add(id);
    scenes.push({
      id,
      mediaType: "photo",
      mediaId: s.mediaId,
      included: s.included,
      durationSeconds: s.durationSeconds,
      caption: s.caption,
      captionVisible: s.captionVisible,
    });
  }

  return {
    ok: true,
    plan: {
      ...stored,
      scenes,
      targetDurationSeconds: projectTargetSeconds,
      captionStyle: sanitizeCaptionStyle(r.captionStyle, stored.captionStyle),
    },
  };
}
