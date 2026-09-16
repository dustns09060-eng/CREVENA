"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { savePhotoBlogToLibrary } from "./actions";
import {
  buildPhotoBlogPrompt,
  buildGuideCheckPrompt,
  buildSinglePhotoSectionPrompt,
  parseJsonResponse,
  type PhotoSummary,
  type RegenerateMode,
} from "@/lib/ai/photo-blog-prompts";
import type { ReviewNotes, StyleSample } from "@/lib/ai/prompts";
import type { ResponseSchema } from "@/lib/ai/types";
import type { GuideAnalysis } from "@/lib/ai/guide-analysis-prompts";
import { OPERATION_CREDIT_COST } from "@/lib/ai/credits";
import { checkAgainstGuideAnalysis } from "@/lib/content-guide-check";
import {
  SectionHeader,
  SaveStatusBadge,
  Toast,
  useSaveToast,
  PlatformStatusPill,
  GuideCheckList,
  type PlatformStatus,
  type GuideCheckItem,
} from "../content/studio-ui";
import type { PhotoManager } from "./usePhotoManager";
import type { PhotoType } from "@/types/database";

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
  responseSchema?: ResponseSchema;
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

export type PhotoBlogStudioHandle = {
  generate: () => Promise<void>;
  isDirty: () => boolean;
};

// STEP35.5: no longer owns photo state — receives the shared PhotoManager
// (usePhotoManager, rendered at the top of the studio as PhotoSection) so
// blog generation, per-photo paragraph editing/regeneration, and the
// "사진과 글 연결" preview (item 9) all read/write the same photos array as
// step 2, instead of a separate local copy.
export const PhotoBlogStudio = forwardRef<PhotoBlogStudioHandle, {
  collaborationId: string;
  photoManager: PhotoManager;
  collaborationInfo: CollaborationInfo;
  reviewNotes: ReviewNotes;
  guideAnalysis: GuideAnalysis | null;
  onStatusChange?: (status: PlatformStatus) => void;
}>(function PhotoBlogStudio({
  collaborationId,
  photoManager,
  collaborationInfo,
  reviewNotes,
  guideAnalysis,
  onStatusChange,
}, ref) {
  const router = useRouter();
  const { photos, excludePhotoIds, applyGeneratedSections, applyRegeneratedBody, handleBodyChange, handleBodyBlur } =
    photoManager;

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
  const [guideCheck, setGuideCheck] = useState<{ missingKeywords: string[]; notes: string } | null>(null);
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
    onStatusChange?.(writing ? "GENERATING" : blogMeta ? "DONE" : "EMPTY");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [writing, blogMeta]);

  const busy = writing || checking || saving || regeneratingId !== null;

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

  // ✓/△/✕ against the structured guide analysis (STEP35.5) when available;
  // falls back to nothing if no guide has been analyzed yet — the AI-based
  // handleGuideCheck below still works either way.
  const guideItems: GuideCheckItem[] = useMemo(() => {
    if (!blogMeta || !guideAnalysis) return [];
    return checkAgainstGuideAnalysis(
      { title: blogMeta.title, body: assembleFullText() },
      guideAnalysis,
      { photoCount: photos.length },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blogMeta, guideAnalysis, photos]);

  async function handleWriteBlog() {
    const usablePhotos = photos.filter((p) => !excludePhotoIds.has(p.id));
    if (usablePhotos.length === 0) {
      const err = new Error("블로그를 작성할 사진이 없습니다.");
      setError(err.message);
      throw err;
    }
    setWriting(true);
    setError(null);
    try {
      const summaries: PhotoSummary[] = usablePhotos.map((p) => ({
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
      const maxTokens = Math.min(2000 + usablePhotos.length * 350, 8192);
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

      setBlogMeta({ title: parsed.title, intro: parsed.intro, closing: parsed.closing, hashtags: parsed.hashtags });
      setLibraryDirty(true);
      const editedIds = new Set(photos.filter((p) => p.body_edited).map((p) => p.id));
      const sectionsToApply = parsed.sections.filter((s) => !editedIds.has(s.photoId));
      await applyGeneratedSections(sectionsToApply);
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
  async function handleCopyTitle() {
    if (blogMeta) await navigator.clipboard.writeText(blogMeta.title);
  }
  async function handleCopyBody() {
    const sections = photos.filter((p) => p.body_section).map((p) => p.body_section).join("\n\n");
    if (!blogMeta) return;
    await navigator.clipboard.writeText([blogMeta.intro, sections, blogMeta.closing].filter(Boolean).join("\n\n"));
  }
  async function handleCopyHashtags() {
    if (blogMeta) await navigator.clipboard.writeText(blogMeta.hashtags);
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

  async function handleRegenerateSection(photo: (typeof photos)[number], mode: RegenerateMode) {
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
      await applyRegeneratedBody(photo.id, parsed.body);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "문단 재생성에 실패했습니다.");
    } finally {
      setRegeneratingId(null);
    }
  }

  const usablePhotos = photos.filter((p) => !excludePhotoIds.has(p.id));
  const hasBlogPhotos = usablePhotos.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-zinc-900">블로그</h2>
          <PlatformStatusPill status={writing ? "GENERATING" : blogMeta ? "DONE" : "EMPTY"} />
          {blogMeta && <SaveStatusBadge state={libraryDirty ? "dirty" : "saved"} />}
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <button
            onClick={handleWriteBlog}
            disabled={busy || !hasBlogPhotos}
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

      {!hasBlogPhotos && !writing && (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-6 py-8 text-center">
          <p className="text-sm text-zinc-500">
            위 &quot;사진 준비&quot;에서 사진을 먼저 추가해주세요. 블로그는 사진을 기반으로 작성됩니다.
          </p>
        </div>
      )}

      {!blogMeta && writing && (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-6 py-8 text-center">
          <p className="text-sm text-zinc-500">블로그 작성 중입니다. 잠시만 기다려주세요...</p>
        </div>
      )}

      {blogMeta && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-4 rounded-xl border border-zinc-100 bg-zinc-50/50 p-4">
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-500">제목</span>
                <button onClick={handleCopyTitle} className="text-[11px] text-zinc-500 hover:underline">
                  제목 복사
                </button>
              </div>
              <input
                value={blogMeta.title}
                onChange={(e) => {
                  setBlogMeta((prev) => (prev ? { ...prev, title: e.target.value } : prev));
                  setLibraryDirty(true);
                }}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium outline-none focus:border-zinc-900"
              />
            </div>

            {/* 사진과 글 연결 미리보기 (item 9): 도입 → 사진별 문단(썸네일 포함) → 마무리 */}
            <div className="flex flex-col gap-3 border-t border-zinc-100 pt-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-500">본문</span>
                <button onClick={handleCopyBody} className="text-[11px] text-zinc-500 hover:underline">
                  본문 복사
                </button>
              </div>

              <p className="whitespace-pre-wrap rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-700">
                {blogMeta.intro}
              </p>

              {usablePhotos.map((photo) => (
                <div key={photo.id} className="flex flex-col gap-2 sm:flex-row">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photo.thumbUrl}
                    alt={photo.original_filename ?? "사진"}
                    className="h-28 w-full shrink-0 rounded-lg object-cover sm:h-auto sm:w-28"
                  />
                  <div className="flex flex-1 flex-col gap-1.5">
                    {photo.body_section ? (
                      <textarea
                        rows={3}
                        value={photo.body_section}
                        onChange={(e) => handleBodyChange(photo.id, e.target.value)}
                        onBlur={(e) => handleBodyBlur(photo.id, e.target.value)}
                        className="whitespace-pre-wrap rounded-lg border border-zinc-200 bg-white p-2.5 text-sm text-zinc-700 outline-none focus:border-zinc-900"
                      />
                    ) : (
                      <p className="text-xs text-zinc-400">이 사진에 대한 문단이 아직 없습니다.</p>
                    )}
                    <div className="flex flex-wrap items-center gap-1">
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
                          {regeneratingId === photo.id ? "생성 중..." : `부분 재생성: ${label}`}
                        </button>
                      ))}
                      <span className="text-[9px] text-zinc-400">
                        클릭당 {OPERATION_CREDIT_COST.PARAGRAPH_REGENERATE} 크레딧
                      </span>
                    </div>
                  </div>
                </div>
              ))}

              <p className="whitespace-pre-wrap rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-700">
                {blogMeta.closing}
              </p>
            </div>

            <div className="flex flex-col gap-1 border-t border-zinc-100 pt-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-500">해시태그</span>
                <button onClick={handleCopyHashtags} className="text-[11px] text-zinc-500 hover:underline">
                  해시태그 복사
                </button>
              </div>
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
    </div>
  );
});
