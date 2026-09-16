"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  uploadPhoto,
  reorderPhotos,
  updatePhotoMemo,
  savePhotoBodySections,
  updatePhotoBodyManual,
  deletePhoto,
  savePhotoBlogToLibrary,
} from "./actions";
import { resizeImage } from "@/lib/image-resize";
import { PHOTO_TYPE_LABELS, PHOTO_TYPES } from "@/lib/photo-type";
import {
  buildPhotoOrderPrompt,
  buildPhotoBlogPrompt,
  buildGuideCheckPrompt,
  buildSinglePhotoSectionPrompt,
  parseJsonResponse,
  type PhotoSummary,
  type RegenerateMode,
} from "@/lib/ai/photo-blog-prompts";
import type { ReviewNotes, StyleSample } from "@/lib/ai/prompts";
import type { ResponseSchema } from "@/lib/ai/types";
import { OPERATION_CREDIT_COST } from "@/lib/ai/credits";
import { checkContentDeterministic } from "@/lib/content-guide-check";
import {
  SectionHeader,
  SaveStatusBadge,
  Toast,
  useSaveToast,
  PlatformStatusPill,
  GuideCheckList,
  buildDeterministicGuideItems,
  PhotoUploadEmptyState,
  type PlatformStatus,
  type GuideCheckItem,
} from "../content/studio-ui";
import type { CollaborationPhoto, PhotoType } from "@/types/database";

type PhotoWithUrl = CollaborationPhoto & { fullUrl: string; thumbUrl: string };

type CollaborationInfo = {
  brandName: string;
  productName: string;
  campaignName: string | null;
  requiredKeywords: string | null;
  requiredHashtags: string | null;
  adDisclosureText: string | null;
  contentGuide: string | null;
  guideRawContent: string | null;
  requiredPhotoCount: number | null;
  styleSamples: StyleSample[];
};

async function callGenerate(args: {
  prompt: string;
  systemPrompt: string;
  collaborationId: string;
  maxTokens?: number;
  operation?: string;
  // Forces the model to answer via Claude's tool-use so the response is
  // guaranteed valid JSON matching this shape (see ResponseSchema in
  // src/lib/ai/types.ts) instead of relying on free-text JSON.parse.
  responseSchema?: ResponseSchema;
  // ORDER_SUGGEST/BLOG_WRITE cost more than the other operations, so they
  // go through their own endpoint where the server fixes the credit cost
  // (see src/app/api/ai/suggest-order and generate-blog) instead of the
  // shared /api/ai/generate route.
  endpoint?: string;
}) {
  const { endpoint = "/api/ai/generate", ...body } = args;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "요청에 실패했습니다.");
  return data.content as string;
}

// STEP33: exposed so the unified 콘텐츠 제작실's "한 번에 생성" bulk action
// can trigger the blog write step alongside Instagram/Threads generation,
// each isolated (Promise.allSettled) so one platform failing doesn't affect
// another. Requires photos already uploaded — callers should check that
// themselves (see StudioTabs) since this component doesn't gate on it.
export type PhotoBlogStudioHandle = {
  generate: () => Promise<void>;
  isDirty: () => boolean;
};

export const PhotoBlogStudio = forwardRef<PhotoBlogStudioHandle, {
  collaborationId: string;
  initialPhotos: PhotoWithUrl[];
  collaborationInfo: CollaborationInfo;
  // Owned by StudioTabs (single "콘텐츠 기본 정보" card, STEP35) and passed
  // down read-only — this panel no longer keeps its own copy or renders its
  // own duplicate editing card, so blog/Instagram/Threads always read the
  // exact same in-memory review notes instead of three independently-edited
  // copies of the same DB row.
  reviewNotes: ReviewNotes;
  onPhotoCountChange?: (count: number) => void;
  onStatusChange?: (status: PlatformStatus) => void;
}>(function PhotoBlogStudio({
  collaborationId,
  initialPhotos,
  collaborationInfo,
  reviewNotes,
  onPhotoCountChange,
  onStatusChange,
}, ref) {
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
  const [analyzeProgress, setAnalyzeProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [ordering, setOrdering] = useState(false);
  const [writing, setWriting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);

  const [blogMeta, setBlogMeta] = useState<{
    title: string;
    intro: string;
    closing: string;
    hashtags: string;
  } | null>(null);
  const [guideCheck, setGuideCheck] = useState<{ missingKeywords: string[]; notes: string } | null>(
    null,
  );
  const [libraryDirty, setLibraryDirty] = useState(false);
  const { toastMessage, showToast } = useSaveToast();

  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (!libraryDirty) return;
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [libraryDirty]);

  useEffect(() => {
    onPhotoCountChange?.(photos.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos.length]);

  useEffect(() => {
    onStatusChange?.(writing ? "GENERATING" : blogMeta ? "DONE" : "EMPTY");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [writing, blogMeta]);

  // Prevents double-clicks across this panel's different async actions
  // (upload, analyze, order, write, regenerate section, guide check, save)
  // from overlapping.
  const busy = uploading || analyzing || ordering || writing || checking || saving || regeneratingId !== null;

  const missingPhotoWarnings = useMemo(() => {
    const warnings: string[] = [];
    const required = collaborationInfo.requiredPhotoCount ?? 0;
    if (required > 0 && photos.length < required) {
      warnings.push(`필수 사진 수(${required}장) 중 ${photos.length}장만 업로드되었습니다.`);
    }
    const guideText = `${collaborationInfo.contentGuide ?? ""} ${collaborationInfo.guideRawContent ?? ""}`;
    const analyzedTypes = new Set(photos.map((p) => p.photo_type).filter(Boolean) as PhotoType[]);
    const anyAnalyzed = photos.some((p) => p.photo_type);
    if (anyAnalyzed && guideText.trim()) {
      const missingTypes = PHOTO_TYPES.filter(
        (t) => t !== "OTHER" && guideText.includes(PHOTO_TYPE_LABELS[t]) && !analyzedTypes.has(t),
      );
      if (missingTypes.length > 0) {
        warnings.push(
          `가이드에 언급된 사진 유형이 없습니다: ${missingTypes.map((t) => PHOTO_TYPE_LABELS[t]).join(", ")}`,
        );
      }
    }
    return warnings;
  }, [photos, collaborationInfo]);

  const assembleFullText = () => {
    if (!blogMeta) return "";
    const sections = photos
      .filter((p) => p.body_section)
      .map((p) => p.body_section)
      .join("\n\n");
    return [blogMeta.title, "", blogMeta.intro, "", sections, "", blogMeta.closing, "", blogMeta.hashtags]
      .join("\n")
      .trim();
  };

  // Deterministic (no AI call) guideline check, reusing the same pure
  // checker STEP33 already added for Instagram/Threads — this just applies
  // it to the blog's assembled text too, plus a photo-count pass/fail item
  // folded in from the existing missingPhotoWarnings logic above.
  const guideItems: GuideCheckItem[] = useMemo(() => {
    if (!blogMeta) return [];
    const fullText = assembleFullText();
    const deterministic = checkContentDeterministic(fullText, {
      requiredKeywords: collaborationInfo.requiredKeywords,
      requiredHashtags: collaborationInfo.requiredHashtags,
      adDisclosureText: collaborationInfo.adDisclosureText,
    });
    const items = buildDeterministicGuideItems(deterministic, {
      requiredKeywords: collaborationInfo.requiredKeywords,
      requiredHashtags: collaborationInfo.requiredHashtags,
      adDisclosureText: collaborationInfo.adDisclosureText,
    });
    const requiredPhotoCount = collaborationInfo.requiredPhotoCount ?? 0;
    if (requiredPhotoCount > 0) {
      items.unshift({
        label: "필수 사진 수",
        state: photos.length >= requiredPhotoCount ? "pass" : "fail",
        detail: photos.length >= requiredPhotoCount ? undefined : `${photos.length}/${requiredPhotoCount}장`,
      });
    }
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blogMeta, photos, collaborationInfo]);

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

  async function handleAnalyzeAll() {
    setAnalyzing(true);
    setError(null);
    try {
      const targets = photos.filter((p) => !p.ai_analysis);
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
      if (targets.length > 0) router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "사진 분석에 실패했습니다.");
    } finally {
      setAnalyzing(false);
      setAnalyzeProgress(null);
    }
  }

  async function handleSuggestOrder() {
    setOrdering(true);
    setError(null);
    try {
      const summaries: PhotoSummary[] = photos.map((p) => ({
        id: p.id,
        photoType: p.photo_type,
        description: p.ai_analysis ?? "(분석 전)",
      }));
      const { systemPrompt, prompt, responseSchema } = buildPhotoOrderPrompt(summaries);
      const raw = await callGenerate({
        systemPrompt,
        prompt,
        collaborationId,
        responseSchema,
        endpoint: "/api/ai/suggest-order",
      });
      const parsed = parseJsonResponse<{ order: string[] }>(raw);
      const byId = new Map(photos.map((p) => [p.id, p]));
      const reordered = parsed.order.map((id) => byId.get(id)).filter(Boolean) as PhotoWithUrl[];
      const missing = photos.filter((p) => !parsed.order.includes(p.id));
      const finalOrder = [...reordered, ...missing];
      setPhotos(finalOrder);
      await reorderPhotos(collaborationId, finalOrder.map((p) => p.id));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "순서 추천에 실패했습니다.");
    } finally {
      setOrdering(false);
    }
  }

  async function handleWriteBlog() {
    setWriting(true);
    setError(null);
    try {
      const summaries: PhotoSummary[] = photos.map((p) => ({
        id: p.id,
        photoType: p.photo_type,
        description: p.ai_analysis ?? "(분석 전)",
        memo: p.user_memo,
      }));
      const { systemPrompt, prompt, responseSchema } = buildPhotoBlogPrompt({
        brandName: collaborationInfo.brandName,
        productName: collaborationInfo.productName,
        campaignName: collaborationInfo.campaignName,
        requiredKeywords: collaborationInfo.requiredKeywords,
        requiredHashtags: collaborationInfo.requiredHashtags,
        adDisclosureText: collaborationInfo.adDisclosureText,
        contentGuide: collaborationInfo.contentGuide,
        guideRawContent: collaborationInfo.guideRawContent,
        reviewNotes,
        styleSamples: collaborationInfo.styleSamples,
        photos: summaries,
      });
      // Each photo needs its own paragraph, so the token budget must scale with photo count
      // (a fixed 2048 cap truncates the JSON response once there are ~8+ photos).
      const maxTokens = Math.min(2000 + photos.length * 350, 8192);
      const raw = await callGenerate({
        systemPrompt,
        prompt,
        collaborationId,
        maxTokens,
        responseSchema,
        endpoint: "/api/ai/generate-blog",
      });
      const parsed = parseJsonResponse<{
        title: string;
        intro: string;
        sections: { photoId: string; body: string }[];
        closing: string;
        hashtags: string;
      }>(raw);

      setBlogMeta({
        title: parsed.title,
        intro: parsed.intro,
        closing: parsed.closing,
        hashtags: parsed.hashtags,
      });
      setLibraryDirty(true);
      // Don't clobber paragraphs the user manually edited — only apply AI output
      // to photos that are still in their AI-generated (unedited) state.
      const editedIds = new Set(photos.filter((p) => p.body_edited).map((p) => p.id));
      const sectionsToApply = parsed.sections.filter((s) => !editedIds.has(s.photoId));
      const bodyById = new Map(sectionsToApply.map((s) => [s.photoId, s.body]));
      setPhotos((prev) =>
        prev.map((p) => (bodyById.has(p.id) ? { ...p, body_section: bodyById.get(p.id)! } : p)),
      );
      if (sectionsToApply.length > 0) {
        await savePhotoBodySections(collaborationId, sectionsToApply);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "블로그 작성에 실패했습니다.");
      throw err;
    } finally {
      setWriting(false);
    }
  }

  useImperativeHandle(ref, () => ({ generate: handleWriteBlog, isDirty: () => libraryDirty }));

  async function handleGuideCheck() {
    setChecking(true);
    setError(null);
    try {
      const fullText = assembleFullText();
      if (!fullText) throw new Error("먼저 블로그 글을 작성해주세요.");
      const presentTypes = Array.from(
        new Set(photos.map((p) => p.photo_type).filter(Boolean) as PhotoType[]),
      );
      const { systemPrompt, prompt, responseSchema } = buildGuideCheckPrompt({
        fullText,
        requiredKeywords: collaborationInfo.requiredKeywords,
        guideRawContent: collaborationInfo.guideRawContent,
        presentPhotoTypes: presentTypes,
      });
      const raw = await callGenerate({
        systemPrompt,
        prompt,
        collaborationId,
        responseSchema,
        operation: "GUIDE_CHECK",
      });
      const parsed = parseJsonResponse<{ missingKeywords: string[]; notes: string }>(raw);
      setGuideCheck(parsed);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "가이드 검사에 실패했습니다.");
    } finally {
      setChecking(false);
    }
  }

  async function handleCopyAll() {
    await navigator.clipboard.writeText(assembleFullText());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const fullText = assembleFullText();
      if (!fullText) throw new Error("먼저 블로그 글을 작성해주세요.");
      const result = await savePhotoBlogToLibrary({ collaborationId, body: fullText });
      if ("error" in result) throw new Error(result.error);
      setLibraryDirty(false);
      showToast("저장되었습니다.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeletePhoto(photo: PhotoWithUrl) {
    setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
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

  async function handleRegenerateSection(photo: PhotoWithUrl, mode: RegenerateMode) {
    setRegeneratingId(photo.id);
    setError(null);
    try {
      const { systemPrompt, prompt, responseSchema } = buildSinglePhotoSectionPrompt({
        brandName: collaborationInfo.brandName,
        productName: collaborationInfo.productName,
        requiredKeywords: collaborationInfo.requiredKeywords,
        reviewNotes,
        styleSamples: collaborationInfo.styleSamples,
        photo: {
          id: photo.id,
          photoType: photo.photo_type,
          description: photo.ai_analysis ?? "(분석 전)",
          memo: photo.user_memo,
        },
        mode,
        currentBody: photo.body_section,
      });
      const raw = await callGenerate({
        systemPrompt,
        prompt,
        collaborationId,
        responseSchema,
        operation: "PARAGRAPH_REGENERATE",
      });
      const parsed = parseJsonResponse<{ body: string }>(raw);
      setPhotos((prev) =>
        prev.map((p) => (p.id === photo.id ? { ...p, body_section: parsed.body, body_edited: false } : p)),
      );
      await savePhotoBodySections(collaborationId, [{ photoId: photo.id, body: parsed.body }]);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "문단 재생성에 실패했습니다.");
    } finally {
      setRegeneratingId(null);
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

  const bodyPreview = blogMeta
    ? [blogMeta.intro, photos.filter((p) => p.body_section).map((p) => p.body_section).join("\n\n"), blogMeta.closing]
        .filter(Boolean)
        .join("\n\n")
    : "";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-zinc-900">블로그</h2>
          <PlatformStatusPill status={writing ? "GENERATING" : blogMeta ? "DONE" : "EMPTY"} />
          {blogMeta && <SaveStatusBadge state={libraryDirty ? "dirty" : "saved"} />}
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <button
            onClick={handleWriteBlog}
            disabled={busy || photos.length === 0}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-50"
          >
            {writing ? "블로그 작성 중..." : blogMeta ? "다시 작성" : "블로그 작성"}
          </button>
          <span className="text-[10px] text-zinc-400">{OPERATION_CREDIT_COST.BLOG_WRITE} 크레딧 사용</span>
        </div>
      </div>

      <p className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
        CREVENA는 사진 설명을 단순 나열하지 않고 실제 사용 경험이 자연스럽게 이어지는 스토리형 블로그
        글을 작성합니다. (문제 제기 → 사용 계기 → 제품 등장 → 실제 사용 → 변화·느낀점 → 추천 대상)
      </p>

      {error && (
        <p className="whitespace-pre-wrap rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {/* ① 콘텐츠 기본 정보는 StudioTabs 상단 카드에서 공통으로 입력/공유되므로
          여기서는 별도로 렌더링하지 않는다. */}

      {/* ② 사진 준비 */}
      <section className="rounded-xl border border-zinc-200 bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionHeader
            step={2}
            title={`사진 준비 (${photos.length}장)`}
            description="사진을 추가하고 AI 분석 → 순서 추천 순서로 준비하세요."
          />
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => handleAddPhotos(e.target.files)}
        />

        {missingPhotoWarnings.length > 0 && (
          <div className="mt-3 flex flex-col gap-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {missingPhotoWarnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
          </div>
        )}

        {photos.length === 0 ? (
          <div className="mt-4">
            <PhotoUploadEmptyState
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              maxCount={collaborationInfo.requiredPhotoCount}
            />
            {uploading && <p className="mt-2 text-center text-xs text-zinc-400">업로드 중...</p>}
          </div>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
              >
                {uploading ? "업로드 중..." : "+ 사진 추가"}
              </button>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleAnalyzeAll}
                  disabled={busy}
                  className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
                >
                  {analyzing
                    ? analyzeProgress
                      ? `분석 중... (${analyzeProgress.done}/${analyzeProgress.total})`
                      : "분석 중..."
                    : "AI 사진 분석"}
                </button>
                <span className="text-[10px] text-zinc-400">
                  사진 장당 {OPERATION_CREDIT_COST.PHOTO_ANALYSIS} 크레딧
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleSuggestOrder}
                  disabled={busy || photos.length < 2}
                  className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
                >
                  {ordering ? "추천 중..." : "사진 순서 추천"}
                </button>
                <span className="text-[10px] text-zinc-400">
                  {OPERATION_CREDIT_COST.ORDER_SUGGEST} 크레딧 사용
                </span>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {photos.map((photo, index) => (
                <div
                  key={photo.id}
                  draggable
                  onDragStart={() => handleDragStart(index)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleDrop(index)}
                  className="flex cursor-move flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-2.5"
                >
                  <div className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photo.thumbUrl}
                      alt={photo.original_filename ?? "사진"}
                      className="aspect-square w-full rounded-lg object-cover"
                    />
                    <span className="absolute left-1 top-1 rounded-full bg-zinc-900/80 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      {index === 0 ? "대표" : `#${index + 1}`}
                    </span>
                    <button
                      onClick={() => handleDeletePhoto(photo)}
                      aria-label="사진 삭제"
                      className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-white/90 text-xs text-red-600 shadow hover:bg-white"
                    >
                      ×
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-1">
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                        photo.photo_type ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-500"
                      }`}
                    >
                      {photo.photo_type ? PHOTO_TYPE_LABELS[photo.photo_type] : "미분석"}
                    </span>
                    <div className="flex gap-0.5">
                      <button
                        onClick={() => handleMove(index, -1)}
                        disabled={index === 0}
                        aria-label="위로 이동"
                        className="rounded border border-zinc-200 px-1 text-[10px] text-zinc-500 hover:bg-zinc-100 disabled:opacity-30"
                      >
                        ↑
                      </button>
                      <button
                        onClick={() => handleMove(index, 1)}
                        disabled={index === photos.length - 1}
                        aria-label="아래로 이동"
                        className="rounded border border-zinc-200 px-1 text-[10px] text-zinc-500 hover:bg-zinc-100 disabled:opacity-30"
                      >
                        ↓
                      </button>
                    </div>
                  </div>

                  {photo.body_edited && (
                    <span className="w-fit rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                      직접 수정됨
                    </span>
                  )}

                  <p className="text-[11px] text-zinc-500">
                    <span className="font-medium text-zinc-600">AI 분석: </span>
                    {photo.ai_analysis ?? "-"}
                  </p>
                  <textarea
                    rows={2}
                    placeholder="사진 메모 (예: 거실에서 촬영)"
                    value={photo.user_memo ?? ""}
                    onChange={(e) => handleMemoChange(photo.id, e.target.value)}
                    onBlur={(e) => handleMemoBlur(photo.id, e.target.value)}
                    className="rounded-lg border border-zinc-200 px-2 py-1.5 text-xs outline-none focus:border-zinc-900"
                  />

                  {photo.body_section && (
                    <textarea
                      rows={3}
                      value={photo.body_section}
                      onChange={(e) => handleBodyChange(photo.id, e.target.value)}
                      onBlur={(e) => handleBodyBlur(photo.id, e.target.value)}
                      className="whitespace-pre-wrap rounded-lg border border-zinc-200 bg-zinc-50 p-2 text-xs text-zinc-700 outline-none focus:border-zinc-900"
                    />
                  )}
                  {photo.ai_analysis && (
                    <div className="flex flex-col gap-1">
                      <div className="flex flex-wrap gap-1">
                        {(
                          [
                            ["REWRITE", "다시쓰기"],
                            ["NATURAL", "자연스럽게"],
                            ["SHORTER", "짧게"],
                            ["LONGER", "길게"],
                          ] as [RegenerateMode, string][]
                        ).map(([mode, label]) => (
                          <button
                            key={mode}
                            onClick={() => handleRegenerateSection(photo, mode)}
                            disabled={busy}
                            className="rounded-full border border-zinc-200 px-2 py-0.5 text-[10px] font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50"
                          >
                            {regeneratingId === photo.id ? "생성 중..." : label}
                          </button>
                        ))}
                      </div>
                      <span className="text-[9px] text-zinc-400">
                        클릭당 {OPERATION_CREDIT_COST.PARAGRAPH_REGENERATE} 크레딧
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* ④ 결과 편집 + ⑤ 최종 검토 및 저장 */}
      {(blogMeta || writing) && (
        <section className="rounded-xl border border-zinc-200 bg-white p-4 sm:p-5">
          <SectionHeader step={4} title="결과 편집" description="AI가 작성한 글을 검토하고 다듬어보세요." />

          {!blogMeta && writing && (
            <div className="mt-4 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-6 py-8 text-center">
              <p className="text-sm text-zinc-500">블로그 작성 중입니다. 잠시만 기다려주세요...</p>
            </div>
          )}

          {blogMeta && (
            <div className="mt-4 flex flex-col gap-4">
              <div className="flex flex-col gap-3 rounded-xl border border-zinc-100 bg-zinc-50/50 p-4">
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-zinc-500">제목</span>
                  <input
                    value={blogMeta.title}
                    onChange={(e) => {
                      setBlogMeta((prev) => (prev ? { ...prev, title: e.target.value } : prev));
                      setLibraryDirty(true);
                    }}
                    className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium outline-none focus:border-zinc-900"
                  />
                </div>
                <div className="flex flex-col gap-1 border-t border-zinc-100 pt-3">
                  <span className="text-xs font-semibold text-zinc-500">본문</span>
                  <p className="whitespace-pre-wrap rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-700">
                    {bodyPreview}
                  </p>
                  <p className="text-[11px] text-zinc-400">
                    본문 문단은 위 사진별 카드에서 각각 수정하거나 부분 재생성할 수 있습니다.
                  </p>
                </div>
                <div className="flex flex-col gap-1 border-t border-zinc-100 pt-3">
                  <span className="text-xs font-semibold text-zinc-500">해시태그</span>
                  <input
                    value={blogMeta.hashtags}
                    onChange={(e) => {
                      setBlogMeta((prev) => (prev ? { ...prev, hashtags: e.target.value } : prev));
                      setLibraryDirty(true);
                    }}
                    className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900"
                  />
                </div>
              </div>

              <SectionHeader step={5} title="최종 검토 및 저장" />

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={handleSave}
                  disabled={busy || !libraryDirty}
                  className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-40"
                >
                  {saving ? "저장 중..." : "저장"}
                </button>
                <button
                  onClick={handleCopyAll}
                  disabled={busy}
                  className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
                >
                  {copied ? "복사됨" : "전체 복사"}
                </button>
                <button
                  onClick={handleGuideCheck}
                  disabled={busy}
                  className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
                >
                  {checking ? "검사 중..." : `AI 가이드 검사 (${OPERATION_CREDIT_COST.GUIDE_CHECK} 크레딧)`}
                </button>
                <Toast message={toastMessage} />
              </div>

              {(guideItems.length > 0 || guideCheck) && (
                <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4">
                  <p className="text-xs font-semibold text-zinc-500">가이드 검사 결과</p>
                  {guideItems.length > 0 && <GuideCheckList items={guideItems} />}
                  {guideCheck && (
                    <div className="border-t border-zinc-100 pt-3">
                      <p className="flex items-center gap-1.5 text-xs font-medium text-amber-600">
                        <span aria-hidden>△</span> AI 세부 검토 의견
                      </p>
                      {guideCheck.missingKeywords.length > 0 && (
                        <p className="mt-1 text-xs text-red-600">
                          누락된 키워드: {guideCheck.missingKeywords.join(", ")}
                        </p>
                      )}
                      <p className="mt-1 whitespace-pre-wrap text-xs text-zinc-600">{guideCheck.notes}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
});
