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
import { updateReviewNotes } from "@/lib/actions/review-notes";
import { OPERATION_CREDIT_COST } from "@/lib/ai/credits";
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

const REVIEW_NOTE_FIELDS: { key: keyof ReviewNotes; label: string }[] = [
  { key: "actualReview", label: "실제 사용 후기" },
  { key: "pros", label: "좋았던 점" },
  { key: "cons", label: "아쉬웠던 점" },
  { key: "kidsReaction", label: "아이 반응" },
  { key: "usageLocation", label: "사용 장소" },
  { key: "usageSituation", label: "사용 상황" },
  { key: "photoDescription", label: "사진 설명" },
  { key: "personalExperience", label: "개인적인 경험" },
];

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
  initialReviewNotes: ReviewNotes;
}>(function PhotoBlogStudio({
  collaborationId,
  initialPhotos,
  collaborationInfo,
  initialReviewNotes,
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

  const [reviewNotes, setReviewNotes] = useState<ReviewNotes>(initialReviewNotes);

  function handleReviewNoteBlur(key: keyof ReviewNotes, value: string) {
    updateReviewNotes(collaborationId, { ...reviewNotes, [key]: value });
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

  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (!libraryDirty) return;
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [libraryDirty]);

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

  return (
    <div className="flex flex-col gap-8">
      <p className="text-xs text-zinc-500">
        사진 추가 → AI 사진 분석 → 사진 순서 추천 → 블로그 작성 → 가이드 검사 → 저장 순서로
        진행하세요.
      </p>
      <section className="flex flex-wrap gap-2 rounded-xl border border-zinc-200 bg-white p-4">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => handleAddPhotos(e.target.files)}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {uploading ? "업로드중..." : "사진 추가"}
        </button>
        <div className="flex flex-col items-start gap-0.5">
          <button
            onClick={handleAnalyzeAll}
            disabled={analyzing || photos.length === 0}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
          >
            {analyzing
              ? analyzeProgress
                ? `분석중... (${analyzeProgress.done}/${analyzeProgress.total})`
                : "분석중..."
              : "AI 사진 분석"}
          </button>
          <span className="text-[10px] text-zinc-400">사진 장당 {OPERATION_CREDIT_COST.PHOTO_ANALYSIS} 크레딧</span>
        </div>
        <div className="flex flex-col items-start gap-0.5">
          <button
            onClick={handleSuggestOrder}
            disabled={ordering || photos.length < 2}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
          >
            {ordering ? "추천중..." : "사진 순서 추천"}
          </button>
          <span className="text-[10px] text-zinc-400">{OPERATION_CREDIT_COST.ORDER_SUGGEST} 크레딧 사용</span>
        </div>
        <div className="flex flex-col items-start gap-0.5">
          <button
            onClick={handleWriteBlog}
            disabled={writing || photos.length === 0}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
          >
            {writing ? "작성중..." : "블로그 작성"}
          </button>
          <span className="text-[10px] text-zinc-400">{OPERATION_CREDIT_COST.BLOG_WRITE} 크레딧 사용</span>
        </div>
        <div className="flex flex-col items-start gap-0.5">
          <button
            onClick={handleGuideCheck}
            disabled={checking || !blogMeta}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
          >
            {checking ? "검사중..." : "가이드 검사"}
          </button>
          <span className="text-[10px] text-zinc-400">{OPERATION_CREDIT_COST.GUIDE_CHECK} 크레딧 사용</span>
        </div>
        <button
          onClick={handleCopyAll}
          disabled={!blogMeta}
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
        >
          {copied ? "복사됨" : "전체 복사"}
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !blogMeta}
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
        >
          {saving ? "저장중..." : "저장"}
        </button>
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {missingPhotoWarnings.length > 0 && (
        <div className="flex flex-col gap-1 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {missingPhotoWarnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </div>
      )}

      <section className="rounded-xl border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-zinc-900">후기 메모</h2>
        <p className="mt-1 text-xs text-zinc-500">
          자동 저장되며, AI 콘텐츠 제작실 화면과 공유됩니다.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {REVIEW_NOTE_FIELDS.map((field) => (
            <label key={field.key} className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-zinc-700">{field.label}</span>
              <textarea
                rows={2}
                value={reviewNotes[field.key] ?? ""}
                onChange={(e) =>
                  setReviewNotes((prev) => ({ ...prev, [field.key]: e.target.value }))
                }
                onBlur={(e) => handleReviewNoteBlur(field.key, e.target.value)}
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-900"
              />
            </label>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-zinc-900">
          사진 ({photos.length}장) — 드래그하거나 ↑/↓ 버튼으로 순서 변경
        </h2>
        {photos.length === 0 ? (
          <p className="text-sm text-zinc-500">업로드된 사진이 없습니다.</p>
        ) : (
          photos.map((photo, index) => (
            <div
              key={photo.id}
              draggable
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(index)}
              className="flex cursor-move flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 sm:flex-row"
            >
              <div className="flex shrink-0 flex-col items-center gap-1">
                <span className="text-xs text-zinc-400">#{index + 1}</span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.thumbUrl}
                  alt={photo.original_filename ?? "사진"}
                  className="h-24 w-24 rounded-lg object-cover"
                />
                <div className="flex gap-1">
                  <button
                    onClick={() => handleMove(index, -1)}
                    disabled={index === 0}
                    aria-label="위로 이동"
                    className="rounded border border-zinc-300 px-1.5 py-0.5 text-xs text-zinc-600 hover:bg-zinc-100 disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => handleMove(index, 1)}
                    disabled={index === photos.length - 1}
                    aria-label="아래로 이동"
                    className="rounded border border-zinc-300 px-1.5 py-0.5 text-xs text-zinc-600 hover:bg-zinc-100 disabled:opacity-30"
                  >
                    ↓
                  </button>
                </div>
                <button
                  onClick={() => handleDeletePhoto(photo)}
                  className="text-xs text-red-600 hover:underline"
                >
                  삭제
                </button>
              </div>

              <div className="flex flex-1 flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700">
                    {photo.photo_type ? PHOTO_TYPE_LABELS[photo.photo_type] : "미분석"}
                  </span>
                  {photo.body_edited && (
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                      직접 수정됨
                    </span>
                  )}
                </div>
                <p className="text-xs text-zinc-500">
                  <span className="font-medium text-zinc-700">AI 분석: </span>
                  {photo.ai_analysis ?? "-"}
                </p>
                <textarea
                  rows={2}
                  placeholder="이 사진에 대한 메모 (예: 거실에서 촬영, 첫째가 직접 사용)"
                  value={photo.user_memo ?? ""}
                  onChange={(e) => handleMemoChange(photo.id, e.target.value)}
                  onBlur={(e) => handleMemoBlur(photo.id, e.target.value)}
                  className="rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-900"
                />

                {(photo.body_section || photo.ai_analysis) && (
                  <div className="flex flex-col gap-2">
                    {photo.body_section && (
                      <textarea
                        rows={3}
                        value={photo.body_section}
                        onChange={(e) => handleBodyChange(photo.id, e.target.value)}
                        onBlur={(e) => handleBodyBlur(photo.id, e.target.value)}
                        className="whitespace-pre-wrap rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700 outline-none focus:border-zinc-900"
                      />
                    )}
                    {photo.ai_analysis && (
                      <div className="flex flex-col gap-1">
                        <div className="flex flex-wrap gap-1">
                          {(
                            [
                              ["REWRITE", "다시쓰기"],
                              ["NATURAL", "더 자연스럽게"],
                              ["SHORTER", "짧게"],
                              ["LONGER", "길게"],
                            ] as [RegenerateMode, string][]
                          ).map(([mode, label]) => (
                            <button
                              key={mode}
                              onClick={() => handleRegenerateSection(photo, mode)}
                              disabled={regeneratingId === photo.id}
                              className="rounded-full border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
                            >
                              {regeneratingId === photo.id ? "생성중..." : label}
                            </button>
                          ))}
                        </div>
                        <span className="text-[10px] text-zinc-400">
                          클릭당 {OPERATION_CREDIT_COST.PARAGRAPH_REGENERATE} 크레딧 사용
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </section>

      {blogMeta && (
        <section className="rounded-xl border border-zinc-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-zinc-900">완성된 블로그 글</h2>
            {libraryDirty && (
              <span className="text-xs font-medium text-amber-600">
                콘텐츠 보관함에 저장되지 않았습니다 — 페이지를 벗어나기 전에 &quot;저장&quot;을
                눌러주세요.
              </span>
            )}
          </div>
          <div className="mt-3 whitespace-pre-wrap rounded-lg bg-zinc-50 p-4 text-sm text-zinc-800">
            {assembleFullText()}
          </div>
        </section>
      )}

      {guideCheck && (
        <section className="rounded-xl border border-zinc-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-zinc-900">가이드 검사 결과</h2>
          {guideCheck.missingKeywords.length > 0 && (
            <p className="mt-2 text-sm text-red-600">
              누락된 키워드: {guideCheck.missingKeywords.join(", ")}
            </p>
          )}
          <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-700">{guideCheck.notes}</p>
        </section>
      )}
    </div>
  );
});
