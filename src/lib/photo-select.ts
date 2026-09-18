// STEP47: AI Photo Select — the selection-state model shared by every
// consumer (Content Studio 사진 준비, Blog, Carousel, Reels, Naver Clip).
//
// ABSOLUTE PRODUCT RULE (STEP47): AI is never the final decision-maker. The
// AI's own pick is only one of the inputs below, and it ALWAYS loses to an
// explicit user choice:
//
//   excludedIds (제외)  > pinnedIds (꼭 사용) > includedIds (사용)
//   > run.selectedPhotoIds (AI 추천) > everything else (AI 미추천)
//
// "다시 추천" re-runs the AI but keeps pinnedIds/excludedIds untouched and
// only lets the AI re-choose among the rest — see buildPhotoSelectPrompt in
// src/lib/ai/photo-select-prompts.ts and applyPhotoSelectRun() below, which
// re-asserts those two sets over whatever the model returned, so even a
// model that ignores the instruction cannot override the user.
//
// There is NO new "selection" architecture downstream: everything still
// funnels into the single `excludePhotoIds` Set that usePhotoManager has
// exposed since STEP35.5, which Blog/Carousel/Reels/Naver Clip already
// filter on. A user who never touches AI Photo Select gets exactly the
// pre-STEP47 behavior (see photoSelectState()'s "no run" branch).

export type PhotoSelectRole =
  | "COVER"
  | "PRODUCT"
  | "PACKAGE"
  | "COMPONENTS"
  | "DETAIL"
  | "USAGE"
  | "RESULT"
  | "OTHER";

export const PHOTO_SELECT_ROLES: PhotoSelectRole[] = [
  "COVER",
  "PRODUCT",
  "PACKAGE",
  "COMPONENTS",
  "DETAIL",
  "USAGE",
  "RESULT",
  "OTHER",
];

export const PHOTO_SELECT_ROLE_LABELS: Record<PhotoSelectRole, string> = {
  COVER: "대표컷",
  PRODUCT: "제품컷",
  PACKAGE: "패키지컷",
  COMPONENTS: "구성컷",
  DETAIL: "디테일컷",
  USAGE: "사용컷",
  RESULT: "결과컷",
  OTHER: "기타",
};

// 충족 / 후보 / 찾지 못함. NOT_FOUND is deliberately a first-class value:
// the AI must say "찾지 못했어요" rather than force a weak photo into a
// required slot (STEP47 절대 원칙).
export type RequiredShotStatus = "MATCHED" | "CANDIDATE" | "NOT_FOUND";

export const REQUIRED_SHOT_STATUS_LABELS: Record<RequiredShotStatus, string> = {
  MATCHED: "충족",
  CANDIDATE: "후보",
  NOT_FOUND: "찾지 못함",
};

export type RequiredShotMatch = {
  requirement: string;
  status: RequiredShotStatus;
  photoIds: string[];
  note: string;
};

// Near-duplicate cluster. NOT computer vision — derived by the same LLM call
// purely from the per-photo 텍스트 분석 설명 it is already reading (see the
// STEP47 report item 18 for the honest precision limits of this).
export type PhotoGroup = {
  photoIds: string[];
  keepPhotoId: string;
  reason: string;
};

export type PhotoSelectReason = {
  photoId: string;
  reason: string;
  role: PhotoSelectRole;
};

export type PhotoSelectRun = {
  generatedAt: string;
  // STEP42-style staleness snapshot — the guide text as it was when this
  // recommendation was produced. Compared against the CURRENT guide text to
  // show "가이드가 변경되었습니다", never to auto-invalidate anything.
  guideTextAtGeneration: string | null;
  // Which photo ids this run actually looked at, so photos added afterwards
  // can be surfaced as "아직 추천에 반영되지 않음" without a full re-analysis.
  consideredPhotoIds: string[];
  selectedPhotoIds: string[];
  coverCandidateIds: string[];
  requiredShots: RequiredShotMatch[];
  groups: PhotoGroup[];
  reasons: PhotoSelectReason[];
};

export type PhotoSelection = {
  version: 1;
  run: PhotoSelectRun | null;
  /** 꼭 사용 — survives 다시 추천. */
  pinnedIds: string[];
  /** 제외 — survives 다시 추천 until the user un-excludes. */
  excludedIds: string[];
  /** 사용 — user turned it on without the AI having suggested it. */
  includedIds: string[];
};

export const EMPTY_PHOTO_SELECTION: PhotoSelection = {
  version: 1,
  run: null,
  pinnedIds: [],
  excludedIds: [],
  includedIds: [],
};

export type PhotoSelectState =
  | "PINNED" // 꼭 사용
  | "AI_PICK" // AI 추천
  | "INCLUDE" // 사용
  | "EXCLUDED" // 제외 (사용자가 직접)
  | "NOT_PICKED"; // AI 미추천 (추천 실행됨, 이 사진은 안 뽑힘)

export const PHOTO_SELECT_STATE_LABELS: Record<PhotoSelectState, string> = {
  PINNED: "꼭 사용",
  AI_PICK: "AI 추천",
  INCLUDE: "사용",
  EXCLUDED: "제외",
  NOT_PICKED: "AI 미추천",
};

export function photoSelectState(photoId: string, selection: PhotoSelection): PhotoSelectState {
  if (selection.excludedIds.includes(photoId)) return "EXCLUDED";
  if (selection.pinnedIds.includes(photoId)) return "PINNED";
  if (selection.includedIds.includes(photoId)) return "INCLUDE";
  if (!selection.run) return "INCLUDE"; // pre-STEP47 behavior: everything is usable
  return selection.run.selectedPhotoIds.includes(photoId) ? "AI_PICK" : "NOT_PICKED";
}

/** States that mean "this photo goes into the generated content". */
export function isUsableState(state: PhotoSelectState): boolean {
  return state === "PINNED" || state === "AI_PICK" || state === "INCLUDE";
}

/**
 * The single Set every downstream consumer already filters on. Adding a
 * STEP47 selection never introduces a second source of truth — it just
 * changes what this Set contains.
 */
export function selectionExcludedIds(photoIds: string[], selection: PhotoSelection): Set<string> {
  const out = new Set<string>();
  for (const id of photoIds) {
    if (!isUsableState(photoSelectState(id, selection))) out.add(id);
  }
  return out;
}

function uniqueKnown(ids: unknown, valid: Set<string>): string[] {
  if (!Array.isArray(ids)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (typeof id !== "string" || !valid.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function sanitizeRun(raw: unknown, valid: Set<string>): PhotoSelectRun | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<PhotoSelectRun>;
  const roleSet = new Set<string>(PHOTO_SELECT_ROLES);
  const groups = Array.isArray(r.groups)
    ? r.groups
        .map((g) => {
          const photoIds = uniqueKnown(g?.photoIds, valid);
          if (photoIds.length < 2) return null;
          const keepPhotoId = typeof g?.keepPhotoId === "string" && photoIds.includes(g.keepPhotoId)
            ? g.keepPhotoId
            : photoIds[0];
          return { photoIds, keepPhotoId, reason: typeof g?.reason === "string" ? g.reason : "" };
        })
        .filter((g): g is PhotoGroup => g !== null)
    : [];
  const requiredShots = Array.isArray(r.requiredShots)
    ? r.requiredShots
        .map((s): RequiredShotMatch | null => {
          if (!s || typeof s.requirement !== "string" || !s.requirement.trim()) return null;
          const photoIds = uniqueKnown(s.photoIds, valid);
          // A requirement whose every matched id was hallucinated (or points
          // at a since-deleted photo) can never be reported as 충족 — it
          // degrades to 찾지 못함, never the other way around.
          let status: RequiredShotStatus =
            s.status === "MATCHED" || s.status === "CANDIDATE" || s.status === "NOT_FOUND"
              ? s.status
              : "NOT_FOUND";
          if (photoIds.length === 0) status = "NOT_FOUND";
          return {
            requirement: s.requirement,
            status,
            photoIds,
            note: typeof s.note === "string" ? s.note : "",
          };
        })
        .filter((s): s is RequiredShotMatch => s !== null)
    : [];
  const reasons = Array.isArray(r.reasons)
    ? r.reasons
        .map((x): PhotoSelectReason | null => {
          if (!x || typeof x.photoId !== "string" || !valid.has(x.photoId)) return null;
          return {
            photoId: x.photoId,
            reason: typeof x.reason === "string" ? x.reason : "",
            role: roleSet.has(x.role as string) ? (x.role as PhotoSelectRole) : "OTHER",
          };
        })
        .filter((x): x is PhotoSelectReason => x !== null)
    : [];

  return {
    generatedAt: typeof r.generatedAt === "string" ? r.generatedAt : new Date().toISOString(),
    guideTextAtGeneration: typeof r.guideTextAtGeneration === "string" ? r.guideTextAtGeneration : null,
    consideredPhotoIds: uniqueKnown(r.consideredPhotoIds, valid),
    selectedPhotoIds: uniqueKnown(r.selectedPhotoIds, valid),
    coverCandidateIds: uniqueKnown(r.coverCandidateIds, valid).slice(0, 3),
    requiredShots,
    groups,
    reasons,
  };
}

/**
 * Defensive normalization applied BOTH when loading a stored selection and
 * right after parsing an AI response:
 *  - every photo id is validated against the real photo id set, so a
 *    hallucinated id (or one whose photo was deleted) is silently dropped
 *    instead of ever being rendered;
 *  - a photo can't be in two user buckets at once.
 */
export function sanitizePhotoSelection(raw: unknown, validPhotoIds: string[]): PhotoSelection {
  const valid = new Set(validPhotoIds);
  if (!raw || typeof raw !== "object") return EMPTY_PHOTO_SELECTION;
  const s = raw as Partial<PhotoSelection>;
  const excludedIds = uniqueKnown(s.excludedIds, valid);
  const pinnedIds = uniqueKnown(s.pinnedIds, valid).filter((id) => !excludedIds.includes(id));
  const includedIds = uniqueKnown(s.includedIds, valid).filter(
    (id) => !excludedIds.includes(id) && !pinnedIds.includes(id),
  );
  return {
    version: 1,
    run: sanitizeRun(s.run, valid),
    pinnedIds,
    excludedIds,
    includedIds,
  };
}

/**
 * Folds a freshly parsed AI run into the existing selection.
 *
 * This is where the "AI must never override 꼭 사용 / 제외" rule is actually
 * enforced in code rather than merely requested in the prompt: pinned ids are
 * force-added to selectedPhotoIds and excluded ids are force-removed, no
 * matter what the model returned.
 */
export function applyPhotoSelectRun(
  previous: PhotoSelection,
  run: PhotoSelectRun,
  validPhotoIds: string[],
): PhotoSelection {
  const sanitized = sanitizePhotoSelection({ ...previous, run }, validPhotoIds);
  const selectedRun = sanitized.run;
  if (!selectedRun) return sanitized;

  const excluded = new Set(sanitized.excludedIds);
  const selected = selectedRun.selectedPhotoIds.filter((id) => !excluded.has(id));
  for (const id of sanitized.pinnedIds) {
    if (!selected.includes(id)) selected.push(id);
  }
  const covers = selectedRun.coverCandidateIds.filter((id) => !excluded.has(id));

  return {
    ...sanitized,
    run: { ...selectedRun, selectedPhotoIds: selected, coverCandidateIds: covers },
  };
}

/** Removes a deleted photo from every id list so no stale id can linger. */
export function forgetPhoto(selection: PhotoSelection, photoId: string): PhotoSelection {
  const strip = (ids: string[]) => ids.filter((id) => id !== photoId);
  return {
    ...selection,
    pinnedIds: strip(selection.pinnedIds),
    excludedIds: strip(selection.excludedIds),
    includedIds: strip(selection.includedIds),
    run: selection.run
      ? {
          ...selection.run,
          consideredPhotoIds: strip(selection.run.consideredPhotoIds),
          selectedPhotoIds: strip(selection.run.selectedPhotoIds),
          coverCandidateIds: strip(selection.run.coverCandidateIds),
          reasons: selection.run.reasons.filter((r) => r.photoId !== photoId),
          groups: selection.run.groups
            .map((g) => {
              const photoIds = strip(g.photoIds);
              if (photoIds.length < 2) return null;
              return {
                ...g,
                photoIds,
                keepPhotoId: photoIds.includes(g.keepPhotoId) ? g.keepPhotoId : photoIds[0],
              };
            })
            .filter((g): g is PhotoGroup => g !== null),
          requiredShots: selection.run.requiredShots.map((s) => {
            const photoIds = strip(s.photoIds);
            return { ...s, photoIds, status: photoIds.length === 0 ? "NOT_FOUND" : s.status };
          }),
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// STEP47 Step 33 — 콘텐츠별 구성.
//
// V1 스코프: ONE common recommended set + a light per-content-type
// adjustment. Deliberately NOT independent per-platform ranking systems.
// Every function below only ever REORDERS or TRIMS the common set; none of
// them can add a photo the user excluded, and none of them pads with
// anything fake when there are fewer photos than a platform could hold.
// ---------------------------------------------------------------------------
export type PhotoSelectContentType = "BLOG" | "INSTAGRAM" | "CAROUSEL" | "SHORTFORM";

export function arrangeForContentType<T extends { id: string }>(
  photos: T[],
  selection: PhotoSelection,
  contentType: PhotoSelectContentType,
  options?: { maxCount?: number },
): T[] {
  const excluded = selectionExcludedIds(photos.map((p) => p.id), selection);
  const usable = photos.filter((p) => !excluded.has(p.id));
  const covers = selection.run?.coverCandidateIds ?? [];

  let arranged = usable;
  if (contentType === "INSTAGRAM" || contentType === "CAROUSEL") {
    // Cover candidates lead; everything else keeps its existing
    // display_order. Nothing is dropped here — only moved.
    const coverSet = new Set(covers);
    arranged = [...usable.filter((p) => coverSet.has(p.id)), ...usable.filter((p) => !coverSet.has(p.id))];
  }

  const max = options?.maxCount;
  return typeof max === "number" && max > 0 ? arranged.slice(0, max) : arranged;
}
