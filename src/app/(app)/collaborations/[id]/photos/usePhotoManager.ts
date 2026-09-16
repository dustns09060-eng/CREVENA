"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  uploadPhoto,
  reorderPhotos,
  updatePhotoMemo,
  updatePhotoBodyManual,
  savePhotoBodySections,
  deletePhoto,
} from "./actions";
import { resizeImage } from "@/lib/image-resize";
import {
  buildPhotoOrderPrompt,
  parseJsonResponse,
  type PhotoSummary,
} from "@/lib/ai/photo-blog-prompts";
import type { CollaborationPhoto } from "@/types/database";

type PhotoWithUrl = CollaborationPhoto & { fullUrl: string; thumbUrl: string };

// STEP35.5: photo CRUD/AI-analysis/ordering, lifted out of PhotoBlogStudio so
// it can be rendered once at the top of the studio (사진 준비, step 2) and
// shared with the blog result view (사진-글 연결 미리보기, step 7) instead of
// living only inside the 블로그 tab. Reuses every existing action/prompt from
// STEP16/33/34 as-is — no new server actions, no schema change. "대표사진"
// reuses the existing display_order column (the first photo IS the primary
// photo) instead of a new column; "제외 추천" is session-only UI state, never
// persisted and never deletes/hides the photo.
export function usePhotoManager(collaborationId: string, initialPhotos: PhotoWithUrl[]) {
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
  const [excludePhotoIds, setExcludePhotoIds] = useState<Set<string>>(new Set());

  const busy = uploading || analyzing || ordering;

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
  async function handleSuggestOrder() {
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
      setExcludePhotoIds(new Set(parsed.excludePhotoIds ?? []));
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
    setExcludePhotoIds((prev) => {
      if (!prev.has(photo.id)) return prev;
      const next = new Set(prev);
      next.delete(photo.id);
      return next;
    });
    await deletePhoto(collaborationId, photo.id, photo.storage_path, photo.thumbnail_path);
    router.refresh();
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
