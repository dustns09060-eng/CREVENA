"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  uploadPhoto,
  reorderPhotos,
  updatePhotoMemo,
  updatePhotoBodyManual,
  savePhotoBodySections,
  deletePhoto,
} from "./actions";
import { savePhotoSelection } from "./photo-select-actions";
import { resizeImage } from "@/lib/image-resize";
import {
  buildPhotoOrderPrompt,
  parseJsonResponse,
  type PhotoSummary,
} from "@/lib/ai/photo-blog-prompts";
import {
  buildPhotoSelectPrompt,
  type PhotoSelectResponse,
} from "@/lib/ai/photo-select-prompts";
import {
  EMPTY_PHOTO_SELECTION,
  applyPhotoSelectRun,
  forgetPhoto,
  photoSelectState,
  sanitizePhotoSelection,
  selectionExcludedIds,
  type PhotoSelectRun,
  type PhotoSelectState,
  type PhotoSelection,
} from "@/lib/photo-select";
import type { GuideAnalysis } from "@/lib/ai/guide-analysis-prompts";
import type { ReviewNotes } from "@/lib/ai/prompts";
import type { CollaborationPhoto } from "@/types/database";

export type PhotoWithUrl = CollaborationPhoto & { fullUrl: string; thumbUrl: string };

// STEP47: the real, per-photo stages the AI Photo Select run goes through.
// Deliberately NOT a fake percentage — each stage flips only when the work
// it names has actually started/finished.
export type PhotoSelectStage = "ANALYZE" | "GUIDE" | "COMPOSE";

export type PhotoSelectProgress = {
  stage: PhotoSelectStage;
  analyzed?: { done: number; total: number };
};

export type PhotoAnalyzeFailure = { id: string; filename: string | null };

export type PhotoSelectRunArgs = {
  brandName: string;
  productName: string;
  guideRawContent: string | null;
  guideAnalysis: GuideAnalysis | null;
  reviewNotes: ReviewNotes;
  minimumPhotos?: number | null;
};

// STEP35.5: photo CRUD/AI-analysis/ordering, lifted out of PhotoBlogStudio so
// it can be rendered once at the top of the studio (사진 준비, step 2) and
// shared with the blog result view (사진-글 연결 미리보기, step 7) instead of
// living only inside the 블로그 tab. Reuses every existing action/prompt from
// STEP16/33/34 as-is — no new server actions, no schema change. "대표사진"
// reuses the existing display_order column (the first photo IS the primary
// photo) instead of a new column; "제외 추천" is session-only UI state, never
// persisted and never deletes/hides the photo.
export function usePhotoManager(
  collaborationId: string,
  initialPhotos: PhotoWithUrl[],
  // STEP47: the stored AI Photo Select state (null when never run, or when
  // migration 0026 isn't applied yet). Sanitized again here so a stored id
  // for a since-deleted photo can never reach the UI.
  initialSelection?: PhotoSelection | null,
) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragIndexRef = useRef<number | null>(null);

  const [photos, setPhotos] = useState<PhotoWithUrl[]>(initialPhotos);
  const [syncedPhotos, setSyncedPhotos] = useState(initialPhotos);
  if (initialPhotos !== syncedPhotos) {
    setSyncedPhotos(initialPhotos);
    setPhotos(initialPhotos);
  }

  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState<{ done: number; total: number } | null>(null);
  const [ordering, setOrdering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // STEP35.5's ORDER_SUGGEST "제외 추천". Kept as its own state so STEP47's
  // selection can layer over it without changing what 사진 순서/대표사진 추천
  // does on its own.
  const [orderExcludeIds, setOrderExcludeIds] = useState<Set<string>>(new Set());

  // ------------------------------------------------------------------
  // STEP47: AI Photo Select state. ONE source of truth for 꼭 사용 / 제외 /
  // 사용 / AI 추천 — every consumer reads it through the derived
  // excludePhotoIds Set that already existed, so no component keeps its own
  // copy.
  // ------------------------------------------------------------------
  const [selection, setSelection] = useState<PhotoSelection>(() =>
    sanitizePhotoSelection(initialSelection ?? EMPTY_PHOTO_SELECTION, initialPhotos.map((p) => p.id)),
  );
  const [syncedSelection, setSyncedSelection] = useState(initialSelection);
  if (initialSelection !== syncedSelection) {
    setSyncedSelection(initialSelection);
    if (initialSelection) {
      setSelection(sanitizePhotoSelection(initialSelection, initialPhotos.map((p) => p.id)));
    }
  }
  const [selecting, setSelecting] = useState(false);
  const selectingRef = useRef(false);
  const [selectProgress, setSelectProgress] = useState<PhotoSelectProgress | null>(null);
  const [selectError, setSelectError] = useState<string | null>(null);
  const [analyzeFailures, setAnalyzeFailures] = useState<PhotoAnalyzeFailure[]>([]);
  // null = not attempted yet; true = the last write really landed in the DB;
  // false = session-only (migration 0026 not applied, or the write failed).
  const [selectionPersisted, setSelectionPersisted] = useState<boolean | null>(null);

  const excludePhotoIds = useMemo(() => {
    const ids = photos.map((p) => p.id);
    const base = selectionExcludedIds(ids, selection);
    if (!selection.run) {
      // No Photo Select run yet → keep the legacy ORDER_SUGGEST behavior
      // exactly as it was before STEP47, except that an explicit user
      // 사용/꼭 사용 still wins.
      for (const id of orderExcludeIds) {
        if (!selection.pinnedIds.includes(id) && !selection.includedIds.includes(id)) base.add(id);
      }
    }
    return base;
  }, [photos, selection, orderExcludeIds]);

  function stateOf(photoId: string): PhotoSelectState {
    const state = photoSelectState(photoId, selection);
    if (state === "INCLUDE" && !selection.run && orderExcludeIds.has(photoId)) return "NOT_PICKED";
    return state;
  }

  // Persists best-effort. Local state is updated first and never rolled back
  // on a failed write — a user's click must not visibly "undo itself"
  // because the DB column isn't there yet. The UI surfaces
  // selectionPersisted === false as an explicit "이 브라우저에서만 유지됨"
  // notice instead of pretending it saved.
  function commitSelection(next: PhotoSelection) {
    setSelection(next);
    void savePhotoSelection(collaborationId, next).then((r) => setSelectionPersisted(r.persisted));
  }
  // STEP36 item 6: which photo ids the current order/exclude suggestion was
  // computed for — adding or removing a photo afterward doesn't discard the
  // suggestion, but flags it stale so the UI can prompt a re-run.
  const [orderSuggestedForIds, setOrderSuggestedForIds] = useState<Set<string> | null>(null);
  const orderStale =
    orderSuggestedForIds !== null &&
    (photos.length !== orderSuggestedForIds.size || photos.some((p) => !orderSuggestedForIds.has(p.id)));

  const busy = uploading || analyzing || ordering || selecting;

  async function handleAddPhotos(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const photoBlob = await resizeImage(file, 1568, 0.85);
        const thumbBlob = await resizeImage(file, 320, 0.8);
        const formData = new FormData();
        formData.append("photo", photoBlob, "photo.jpg");
        formData.append("thumbnail", thumbBlob, "thumb.jpg");
        formData.append("filename", file.name);
        const result = await uploadPhoto(collaborationId, formData);
        if ("error" in result) throw new Error(result.error);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "업로드에 실패했습니다.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // Only analyzes photos that don't already have ai_analysis — re-running the
  // one-click pipeline (or "AI 사진 분석") never re-spends credits on photos
  // already analyzed (STEP35.5 item 5).
  async function handleAnalyzeAll() {
    const targets = photos.filter((p) => !p.ai_analysis);
    if (targets.length === 0) return;
    setAnalyzing(true);
    setError(null);
    try {
      setAnalyzeProgress({ done: 0, total: targets.length });
      let done = 0;
      for (const photo of targets) {
        const res = await fetch("/api/ai/analyze-photo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ photoId: photo.id }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "사진 분석에 실패했습니다.");
        setPhotos((prev) =>
          prev.map((p) =>
            p.id === photo.id ? { ...p, photo_type: data.photoType, ai_analysis: data.description } : p,
          ),
        );
        done += 1;
        setAnalyzeProgress({ done, total: targets.length });
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "사진 분석에 실패했습니다.");
      throw err;
    } finally {
      setAnalyzing(false);
      setAnalyzeProgress(null);
    }
  }

  // Also asks for a primary-photo and "probably skip these" suggestion in the
  // same call (see the extended photoOrderSchema) — no extra AI call/credit.
  // STEP36 item 9: minimumPhotos (from the guide's structured analysis, when
  // available) caps how many photos the AI's exclude-suggestion may remove —
  // the guide's required photo count always takes priority over the
  // suggestion, and photos are still never deleted, only marked 제외.
  async function handleSuggestOrder(minimumPhotos?: number | null) {
    if (photos.length < 2) return;
    setOrdering(true);
    setError(null);
    try {
      const summaries: PhotoSummary[] = photos.map((p) => ({
        id: p.id,
        photoType: p.photo_type,
        description: p.ai_analysis ?? "(분석 전)",
      }));
      const { systemPrompt, prompt, responseSchema } = buildPhotoOrderPrompt(summaries);
      const res = await fetch("/api/ai/suggest-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemPrompt, prompt, collaborationId, responseSchema }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "요청에 실패했습니다.");
      const parsed = parseJsonResponse<{
        order: string[];
        primaryPhotoId?: string;
        excludePhotoIds?: string[];
      }>(data.content);

      const byId = new Map(photos.map((p) => [p.id, p]));
      const reordered = parsed.order.map((id) => byId.get(id)).filter(Boolean) as PhotoWithUrl[];
      const missing = photos.filter((p) => !parsed.order.includes(p.id));
      let finalOrder = [...reordered, ...missing];

      // Primary photo = index 0, reusing display_order (no new column).
      if (parsed.primaryPhotoId) {
        const idx = finalOrder.findIndex((p) => p.id === parsed.primaryPhotoId);
        if (idx > 0) {
          const [primary] = finalOrder.splice(idx, 1);
          finalOrder = [primary, ...finalOrder];
        }
      }

      setPhotos(finalOrder);
      let excludeIds = parsed.excludePhotoIds ?? [];
      if (minimumPhotos && finalOrder.length - excludeIds.length < minimumPhotos) {
        const allowedExcludeCount = Math.max(0, finalOrder.length - minimumPhotos);
        excludeIds = excludeIds.slice(0, allowedExcludeCount);
      }
      setOrderExcludeIds(new Set(excludeIds));
      setOrderSuggestedForIds(new Set(finalOrder.map((p) => p.id)));
      await reorderPhotos(collaborationId, finalOrder.map((p) => p.id));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "순서 추천에 실패했습니다.");
      throw err;
    } finally {
      setOrdering(false);
    }
  }

  async function setPrimary(photoId: string) {
    const idx = photos.findIndex((p) => p.id === photoId);
    if (idx <= 0) return;
    const next = [...photos];
    const [primary] = next.splice(idx, 1);
    next.unshift(primary);
    setPhotos(next);
    await reorderPhotos(collaborationId, next.map((p) => p.id));
  }

  async function handleDeletePhoto(photo: PhotoWithUrl) {
    setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
    setOrderExcludeIds((prev) => {
      if (!prev.has(photo.id)) return prev;
      const next = new Set(prev);
      next.delete(photo.id);
      return next;
    });
    // STEP47 item 58: a deleted photo must not leave a dangling id anywhere
    // in the stored recommendation. Cleaned up here AND filtered again
    // defensively on every read (sanitizePhotoSelection), so an id that
    // slipped through some other delete path still can never be rendered.
    setSelection((prev) => {
      const next = forgetPhoto(prev, photo.id);
      if (next.run || prev.pinnedIds.length || prev.excludedIds.length || prev.includedIds.length) {
        void savePhotoSelection(collaborationId, next).then((r) => setSelectionPersisted(r.persisted));
      }
      return next;
    });
    setAnalyzeFailures((prev) => prev.filter((f) => f.id !== photo.id));
    await deletePhoto(collaborationId, photo.id, photo.storage_path, photo.thumbnail_path);
    router.refresh();
  }

  // ------------------------------------------------------------------
  // STEP47: AI Photo Select
  // ------------------------------------------------------------------

  // Fault-tolerant sibling of handleAnalyzeAll: one failing photo never
  // aborts the batch, and every photo that DID succeed keeps its analysis
  // (so retrying only the failures never re-charges the ones that worked —
  // handleAnalyzeAll/analyzeMissing both skip photos that already have
  // ai_analysis). Returns the photos as they now stand so the caller
  // doesn't have to wait for a React state flush.
  async function analyzeMissing(
    targetIds?: string[],
  ): Promise<{ photos: PhotoWithUrl[]; failures: PhotoAnalyzeFailure[] }> {
    const pool = targetIds ? photos.filter((p) => targetIds.includes(p.id)) : photos;
    const targets = pool.filter((p) => !p.ai_analysis);
    let current = photos;
    const failures: PhotoAnalyzeFailure[] = [];
    if (targets.length === 0) return { photos: current, failures };

    setAnalyzeProgress({ done: 0, total: targets.length });
    let done = 0;
    for (const photo of targets) {
      try {
        const res = await fetch("/api/ai/analyze-photo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ photoId: photo.id }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "사진 분석에 실패했습니다.");
        current = current.map((p) =>
          p.id === photo.id ? { ...p, photo_type: data.photoType, ai_analysis: data.description } : p,
        );
        setPhotos(current);
      } catch {
        failures.push({ id: photo.id, filename: photo.original_filename });
      }
      done += 1;
      setAnalyzeProgress({ done, total: targets.length });
      setSelectProgress({ stage: "ANALYZE", analyzed: { done, total: targets.length } });
    }
    setAnalyzeProgress(null);
    return { photos: current, failures };
  }

  async function runPhotoSelect(args: PhotoSelectRunArgs, options?: { retryPhotoIds?: string[] }) {
    if (selectingRef.current) return;
    if (photos.length === 0) {
      setSelectError("먼저 사진을 추가해주세요.");
      return;
    }
    selectingRef.current = true;
    setSelecting(true);
    setSelectError(null);
    try {
      // 1) 사진 분석 중 — only photos with no ai_analysis yet are sent, so
      //    re-running never re-charges an already-analyzed photo (STEP47
      //    items 10/12/13). New photos added after an earlier run are
      //    picked up here automatically, and nothing else is re-analyzed.
      setSelectProgress({ stage: "ANALYZE" });
      const { photos: analyzed, failures } = await analyzeMissing(options?.retryPhotoIds);
      setAnalyzeFailures(failures);

      const usable = analyzed.filter((p) => p.ai_analysis);
      if (usable.length === 0) {
        throw new Error("분석된 사진이 없어 추천할 수 없습니다. 사진 분석을 먼저 완료해주세요.");
      }

      // 2) 가이드와 비교 중 / 3) 추천 구성 중 — one structured AI call.
      setSelectProgress({ stage: "GUIDE" });
      const excluded = new Set(selection.excludedIds);
      const candidates = usable.filter((p) => !excluded.has(p.id));
      if (candidates.length === 0) {
        throw new Error("모든 사진이 제외되어 있습니다. 제외를 해제한 뒤 다시 시도해주세요.");
      }

      const { systemPrompt, prompt, responseSchema } = buildPhotoSelectPrompt({
        brandName: args.brandName,
        productName: args.productName,
        guideRawContent: args.guideRawContent,
        guideAnalysis: args.guideAnalysis,
        reviewNotes: args.reviewNotes,
        minimumPhotos: args.minimumPhotos,
        pinnedPhotoIds: selection.pinnedIds.filter((id) => candidates.some((p) => p.id === id)),
        excludedPhotoIds: selection.excludedIds,
        photos: candidates.map((p, i) => ({
          id: p.id,
          photoType: p.photo_type,
          description: p.ai_analysis as string,
          memo: p.user_memo,
          position: i + 1,
          hasEdit: !!p.edited_storage_path,
        })),
      });

      setSelectProgress({ stage: "COMPOSE" });
      // Reuses the existing ORDER_SUGGEST route/price (2 credits) — see the
      // header of src/lib/ai/photo-select-prompts.ts for why this is not a
      // new operation.
      const res = await fetch("/api/ai/suggest-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemPrompt, prompt, collaborationId, responseSchema }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "사진 추천에 실패했습니다.");
      const parsed = parseJsonResponse<PhotoSelectResponse>(data.content);

      const run: PhotoSelectRun = {
        generatedAt: new Date().toISOString(),
        guideTextAtGeneration: args.guideRawContent ?? null,
        consideredPhotoIds: candidates.map((p) => p.id),
        selectedPhotoIds: parsed.selectedPhotoIds ?? [],
        coverCandidateIds: parsed.coverCandidateIds ?? [],
        requiredShots: (parsed.requiredShots ?? []) as PhotoSelectRun["requiredShots"],
        groups: parsed.groups ?? [],
        reasons: (parsed.reasons ?? []) as PhotoSelectRun["reasons"],
      };

      // applyPhotoSelectRun re-asserts 꼭 사용/제외 over whatever the model
      // returned and drops every id that isn't a real photo of THIS
      // collaboration.
      const next = applyPhotoSelectRun(selection, run, analyzed.map((p) => p.id));
      if (!next.run || next.run.selectedPhotoIds.length === 0) {
        throw new Error("AI가 사용할 사진을 고르지 못했습니다. 다시 시도해주세요.");
      }
      commitSelection(next);

      // 대표 이미지 후보 1순위를 기존 "대표사진"(display_order 0) 자리로
      // 옮긴다 — 새 컬럼/개념을 만들지 않고 STEP35.5의 대표사진 규칙을 그대로
      // 쓴다. 사용자는 기존 "대표" 버튼으로 언제든 바꿀 수 있다.
      const cover = next.run.coverCandidateIds[0];
      if (cover) {
        const idx = analyzed.findIndex((p) => p.id === cover);
        if (idx > 0) {
          const reordered = [...analyzed];
          const [primary] = reordered.splice(idx, 1);
          reordered.unshift(primary);
          setPhotos(reordered);
          await reorderPhotos(collaborationId, reordered.map((p) => p.id));
        }
      }
      router.refresh();
    } catch (err) {
      setSelectError(err instanceof Error ? err.message : "사진 추천에 실패했습니다.");
    } finally {
      selectingRef.current = false;
      setSelecting(false);
      setSelectProgress(null);
    }
  }

  /** Retries ONLY the photos whose analysis failed. Already-analyzed photos
   *  are skipped by analyzeMissing, so nothing is charged twice. */
  async function retryFailedAnalyses() {
    if (analyzeFailures.length === 0 || selectingRef.current) return;
    selectingRef.current = true;
    setSelecting(true);
    try {
      const { failures } = await analyzeMissing(analyzeFailures.map((f) => f.id));
      setAnalyzeFailures(failures);
    } finally {
      selectingRef.current = false;
      setSelecting(false);
      setSelectProgress(null);
    }
  }

  function setPhotoSelectState(photoId: string, state: "PINNED" | "EXCLUDED" | "INCLUDE" | "AUTO") {
    const strip = (ids: string[]) => ids.filter((id) => id !== photoId);
    const base: PhotoSelection = {
      ...selection,
      pinnedIds: strip(selection.pinnedIds),
      excludedIds: strip(selection.excludedIds),
      includedIds: strip(selection.includedIds),
    };
    if (state === "PINNED") base.pinnedIds = [...base.pinnedIds, photoId];
    else if (state === "EXCLUDED") base.excludedIds = [...base.excludedIds, photoId];
    else if (state === "INCLUDE") base.includedIds = [...base.includedIds, photoId];
    commitSelection(base);
  }

  /** 추천 초기화 — clears the AI run AND every user override, returning the
   *  studio to its exact pre-STEP47 behavior. Never deletes a photo. */
  function resetPhotoSelection() {
    commitSelection({ ...EMPTY_PHOTO_SELECTION });
    setAnalyzeFailures([]);
    setSelectError(null);
  }

  function handleMemoChange(photoId: string, memo: string) {
    setPhotos((prev) => prev.map((p) => (p.id === photoId ? { ...p, user_memo: memo } : p)));
  }

  async function handleMemoBlur(photoId: string, memo: string) {
    await updatePhotoMemo(collaborationId, photoId, memo);
  }

  function handleBodyChange(photoId: string, body: string) {
    setPhotos((prev) => prev.map((p) => (p.id === photoId ? { ...p, body_section: body } : p)));
  }

  async function handleBodyBlur(photoId: string, body: string) {
    await updatePhotoBodyManual(collaborationId, photoId, body);
    setPhotos((prev) => prev.map((p) => (p.id === photoId ? { ...p, body_edited: true } : p)));
  }

  // Both of these update local state immediately for a snappy UI, but also
  // persist to collaboration_photos.body_section right away — otherwise the
  // next router.refresh() (fired right after by the caller) re-fetches the
  // old DB row and silently wipes the just-generated paragraph back to
  // empty, since the photos array is re-synced from server props whenever
  // they change (see the initialPhotos-sync block above).
  async function applyRegeneratedBody(photoId: string, body: string) {
    setPhotos((prev) => prev.map((p) => (p.id === photoId ? { ...p, body_section: body, body_edited: false } : p)));
    await savePhotoBodySections(collaborationId, [{ photoId, body }]);
  }

  async function applyGeneratedSections(sections: { photoId: string; body: string }[]) {
    const bodyById = new Map(sections.map((s) => [s.photoId, s.body]));
    setPhotos((prev) => prev.map((p) => (bodyById.has(p.id) ? { ...p, body_section: bodyById.get(p.id)! } : p)));
    if (sections.length > 0) {
      await savePhotoBodySections(collaborationId, sections);
    }
  }

  function handleDragStart(index: number) {
    dragIndexRef.current = index;
  }

  function handleDrop(index: number) {
    const from = dragIndexRef.current;
    dragIndexRef.current = null;
    if (from === null || from === index) return;
    setPhotos((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(index, 0, moved);
      reorderPhotos(collaborationId, next.map((p) => p.id));
      return next;
    });
  }

  // Button-based reorder for touch devices, where HTML5 drag-and-drop doesn't work.
  function handleMove(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= photos.length) return;
    setPhotos((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      reorderPhotos(collaborationId, next.map((p) => p.id));
      return next;
    });
  }

  return {
    photos,
    fileInputRef,
    uploading,
    analyzing,
    analyzeProgress,
    ordering,
    busy,
    error,
    setError,
    excludePhotoIds,
    orderStale,
    // STEP47
    selection,
    stateOf,
    selecting,
    selectProgress,
    selectError,
    setSelectError,
    analyzeFailures,
    selectionPersisted,
    runPhotoSelect,
    retryFailedAnalyses,
    setPhotoSelectState,
    resetPhotoSelection,
    handleAddPhotos,
    handleAnalyzeAll,
    handleSuggestOrder,
    setPrimary,
    handleDeletePhoto,
    handleMemoChange,
    handleMemoBlur,
    handleBodyChange,
    handleBodyBlur,
    applyRegeneratedBody,
    applyGeneratedSections,
    handleDragStart,
    handleDrop,
    handleMove,
  };
}

export type PhotoManager = ReturnType<typeof usePhotoManager>;
