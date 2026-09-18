import type { CarouselCard, CarouselProject } from "../carousel/actions";
import type { ReelsProject, ReelsScene } from "./actions";

// STEP42 item 9/10: "이 카드뉴스로 릴스 만들기" — a pure, deterministic
// mapping with NO AI call. Everything a Reels scene needs (photo, order,
// caption text) already exists on the CarouselCard, so re-deriving it via an
// AI call would just be a slower, costlier way of copying data CREVENA
// already has. This function never touches the network and never produces
// an ai_usage_logs row.
const DEFAULT_SCENE_DURATION_SECONDS = 2.5;
const DURATION_OPTIONS = [15, 30, 60] as const;
const CAPTION_MAX_LENGTH = 40;

// Reels captions are a short on-screen line (see reels/render.ts's caption
// box, sized for ~1-2 short lines) — a full card body would overflow the box
// or force illegibly small text, so this deliberately never carries the
// whole body over, only a short prefix truncated with "…".
function captionFromCard(card: CarouselCard): string {
  const headline = card.headline.trim();
  if (headline) {
    return headline.length <= CAPTION_MAX_LENGTH ? headline : `${headline.slice(0, CAPTION_MAX_LENGTH - 1)}…`;
  }
  const body = card.body.trim();
  return body.length <= CAPTION_MAX_LENGTH ? body : `${body.slice(0, CAPTION_MAX_LENGTH - 1)}…`;
}

function closestDurationOption(totalSeconds: number): 15 | 30 | 60 {
  return DURATION_OPTIONS.reduce((best, option) =>
    Math.abs(option - totalSeconds) < Math.abs(best - totalSeconds) ? option : best,
  );
}

export function mapCarouselToReelsScenes(carousel: CarouselProject): ReelsScene[] {
  return carousel.cards
    .filter((c) => c.included)
    .map((card, i): ReelsScene => ({
      // STEP47 fix: unique per scene, not per photo — a carousel may legally
      // use the same photo on two cards, and a duplicated scene id makes
      // editing one scene edit the other (see ReelsStudio's same fix).
      id: `${i}-photo:${card.photoId}`,
      mediaType: "photo",
      mediaId: card.photoId,
      included: true,
      durationSeconds: DEFAULT_SCENE_DURATION_SECONDS,
      caption: captionFromCard(card),
      captionVisible: true,
    }));
}

export function buildReelsProjectFromCarousel(carousel: CarouselProject): Omit<ReelsProject, "sourceMeta"> {
  const scenes = mapCarouselToReelsScenes(carousel);
  const totalSeconds = scenes.reduce((sum, s) => sum + s.durationSeconds, 0);
  return {
    scenes,
    targetDurationSeconds: closestDurationOption(totalSeconds),
    captionStyle: { preset: "basic", position: "bottom", size: "medium" },
    guideTextAtGeneration: carousel.guideTextAtGeneration ?? null,
  };
}
