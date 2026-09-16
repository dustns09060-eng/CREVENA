"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  buildContentPrompt,
  buildFieldRegeneratePrompt,
  assembleInstagramText,
  assembleThreadsText,
  type ContentGenerationInput,
  type ContentPlatformKey,
  type InstagramParts,
  type ThreadsParts,
  type ReviewNotes,
} from "@/lib/ai/prompts";
import { buildGuideCheckPrompt } from "@/lib/ai/photo-blog-prompts";
import { parseJsonResponse } from "@/lib/ai/photo-blog-prompts";
import { checkContentDeterministic, checkAgainstGuideAnalysis } from "@/lib/content-guide-check";
import type { GuideAnalysis } from "@/lib/ai/guide-analysis-prompts";
import { CONTENT_STATUS_LABELS, CONTENT_STATUSES } from "@/lib/content-status";
import { saveContent, updateContent, updateContentStatus } from "./actions";
import { OPERATION_CREDIT_COST } from "@/lib/ai/credits";
import {
  SaveStatusBadge,
  Toast,
  useSaveToast,
  PlatformStatusPill,
  GuideCheckList,
  buildDeterministicGuideItems,
  type PlatformStatus,
} from "./studio-ui";
import type { ContentStatus } from "@/types/database";

export type PlatformParts = InstagramParts | ThreadsParts;

export type PlatformPanelHandle = {
  generate: () => Promise<void>;
  isDirty: () => boolean;
};

function emptyParts(platform: ContentPlatformKey): PlatformParts {
  return platform === "INSTAGRAM_FEED"
    ? { hook: "", body: "", cta: "", hashtags: "" }
    : { posts: [] };
}

function assembleText(platform: ContentPlatformKey, parts: PlatformParts): string {
  return platform === "INSTAGRAM_FEED"
    ? assembleInstagramText(parts as InstagramParts)
    : assembleThreadsText(parts as ThreadsParts);
}

const PLATFORM_LABELS: Record<ContentPlatformKey, string> = {
  INSTAGRAM_FEED: "Instagram",
  THREADS: "Threads",
};

export const PlatformPanel = forwardRef<
  PlatformPanelHandle,
  {
    platform: ContentPlatformKey;
    collaborationId: string;
    collaborationInfo: Omit<ContentGenerationInput, "reviewNotes">;
    reviewNotes: ReviewNotes;
    initial?: { id: string; body: string; status: ContentStatus; generationInput: PlatformParts | null };
    guideAnalysis?: GuideAnalysis | null;
    onStatusChange?: (status: PlatformStatus) => void;
  }
>(function PlatformPanel(
  { platform, collaborationId, collaborationInfo, reviewNotes, initial, guideAnalysis, onStatusChange },
  ref,
) {
  const router = useRouter();
  const [parts, setParts] = useState<PlatformParts>(initial?.generationInput ?? emptyParts(platform));
  const [savedId, setSavedId] = useState<string | null>(initial?.id ?? null);
  const [status, setStatus] = useState<ContentStatus>(initial?.status ?? "DRAFT");
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [regeneratingField, setRegeneratingField] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiCheckNotes, setAiCheckNotes] = useState<string | null>(null);
  const [checkingAi, setCheckingAi] = useState(false);
  const { toastMessage, showToast } = useSaveToast();

  const hasContent = platform === "INSTAGRAM_FEED"
    ? Boolean((parts as InstagramParts).body)
    : (parts as ThreadsParts).posts.length > 0;

  useEffect(() => {
    onStatusChange?.(loading ? "GENERATING" : hasContent ? "DONE" : "EMPTY");
    // onStatusChange identity may change per render on the parent; only the
    // values below should re-trigger a status report.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, hasContent]);

  const flatText = useMemo(() => assembleText(platform, parts), [platform, parts]);
  const deterministicCheck = useMemo(
    () =>
      hasContent
        ? checkContentDeterministic(flatText, {
            requiredKeywords: collaborationInfo.requiredKeywords,
            requiredHashtags: collaborationInfo.requiredHashtags,
            requiredMentions: collaborationInfo.requiredMentions,
            adDisclosureText: collaborationInfo.adDisclosureText,
          })
        : null,
    [hasContent, flatText, collaborationInfo],
  );
  // Prefer the STEP35.5 structured guide analysis when available (covers
  // more than requiredKeywords/Hashtags/Mentions — min length, prohibited
  // expressions, required URLs, etc.); otherwise fall back to the STEP33
  // deterministic check against the collaboration's plain guide fields.
  const guideItems = useMemo(() => {
    if (!hasContent) return [];
    if (guideAnalysis) {
      return checkAgainstGuideAnalysis({ body: flatText }, guideAnalysis);
    }
    return deterministicCheck
      ? buildDeterministicGuideItems(deterministicCheck, {
          requiredKeywords: collaborationInfo.requiredKeywords,
          requiredHashtags: collaborationInfo.requiredHashtags,
          requiredMentions: collaborationInfo.requiredMentions,
          adDisclosureText: collaborationInfo.adDisclosureText,
        })
      : [];
  }, [hasContent, guideAnalysis, flatText, deterministicCheck, collaborationInfo]);

  async function generate() {
    setLoading(true);
    setError(null);
    setAiCheckNotes(null);
    try {
      const { systemPrompt, prompt, responseSchema } = buildContentPrompt(platform, {
        ...collaborationInfo,
        reviewNotes,
      });
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, systemPrompt, responseSchema, operation: "CONTENT_GENERATE" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "생성에 실패했습니다.");
      const newParts =
        platform === "INSTAGRAM_FEED"
          ? parseJsonResponse<InstagramParts>(data.content)
          : parseJsonResponse<ThreadsParts>(data.content);
      setParts(newParts);
      setSavedId(null);
      setStatus("DRAFT");
      setDirty(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "생성에 실패했습니다.");
      throw err;
    } finally {
      setLoading(false);
    }
  }

  async function regenerateField(field: string, postIndex?: number) {
    const key = postIndex !== undefined ? `post-${postIndex}` : field;
    setRegeneratingField(key);
    setError(null);
    try {
      const target =
        platform === "INSTAGRAM_FEED"
          ? ({ platform: "INSTAGRAM_FEED", field: field as keyof InstagramParts, current: parts as InstagramParts } as const)
          : ({ platform: "THREADS", field: "post", postIndex: postIndex!, current: parts as ThreadsParts } as const);
      const { systemPrompt, prompt, responseSchema } = buildFieldRegeneratePrompt(target, {
        ...collaborationInfo,
        reviewNotes,
      });
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, systemPrompt, responseSchema, operation: "PARAGRAPH_REGENERATE" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "재생성에 실패했습니다.");
      const { value } = parseJsonResponse<{ value: string }>(data.content);
      if (platform === "INSTAGRAM_FEED") {
        setParts((prev) => ({ ...(prev as InstagramParts), [field]: value }));
      } else {
        setParts((prev) => {
          const next = [...(prev as ThreadsParts).posts];
          next[postIndex!] = value;
          return { posts: next };
        });
      }
      setDirty(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "재생성에 실패했습니다.");
    } finally {
      setRegeneratingField(null);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const body = assembleText(platform, parts);
      if (!body.trim()) throw new Error("저장할 내용이 없습니다.");
      const result = savedId
        ? await updateContent({ contentId: savedId, collaborationId, body, generationInput: parts })
        : await saveContent({ collaborationId, platform, body, generationInput: parts });
      if ("error" in result) throw new Error(result.error);
      setSavedId(result.id);
      setDirty(false);
      showToast("저장되었습니다.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(flatText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function changeStatus(next: ContentStatus) {
    if (!savedId) return;
    const prev = status;
    setStatus(next);
    const result = await updateContentStatus({ contentId: savedId, collaborationId, status: next });
    if ("error" in result) {
      setStatus(prev);
      setError(result.error);
    }
  }

  async function runAiGuideCheck() {
    setCheckingAi(true);
    setError(null);
    try {
      const { systemPrompt, prompt, responseSchema } = buildGuideCheckPrompt({
        fullText: flatText,
        requiredKeywords: collaborationInfo.requiredKeywords,
        guideRawContent: collaborationInfo.guideRawContent,
        presentPhotoTypes: [],
      });
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, systemPrompt, responseSchema, operation: "GUIDE_CHECK" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "가이드 검사에 실패했습니다.");
      const parsed = parseJsonResponse<{ missingKeywords: string[]; notes: string }>(data.content);
      setAiCheckNotes(parsed.notes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "가이드 검사에 실패했습니다.");
    } finally {
      setCheckingAi(false);
    }
  }

  useImperativeHandle(ref, () => ({ generate, isDirty: () => dirty }));

  const FIELD_LABELS: Record<keyof InstagramParts, string> = {
    hook: "Hook",
    body: "본문",
    cta: "CTA",
    hashtags: "해시태그",
  };
  // Prevents double-clicks across the panel's different async actions (full
  // generate, per-field regenerate, save, AI guide check) from overlapping.
  const anyRegenerating = regeneratingField !== null;
  const busy = loading || anyRegenerating || saving || checkingAi;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-zinc-900">{PLATFORM_LABELS[platform]}</h2>
          <PlatformStatusPill status={loading ? "GENERATING" : hasContent ? "DONE" : "EMPTY"} />
          {!loading && hasContent && <SaveStatusBadge state={dirty ? "dirty" : "saved"} />}
        </div>
        <div className="flex items-center gap-2">
          {savedId && (
            <select
              value={status}
              onChange={(e) => changeStatus(e.target.value as ContentStatus)}
              className="rounded-full border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700"
            >
              {CONTENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {CONTENT_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          )}
          <div className="flex flex-col items-end gap-0.5">
            <button
              onClick={generate}
              disabled={busy}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-50"
            >
              {loading ? `${PLATFORM_LABELS[platform]} 작성 중...` : hasContent ? "다시 생성" : "생성"}
            </button>
            <span className="text-[10px] text-zinc-400">{OPERATION_CREDIT_COST.CONTENT_GENERATE} 크레딧 사용</span>
          </div>
        </div>
      </div>

      {error && (
        <p className="whitespace-pre-wrap rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {hasContent && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4">
            {platform === "INSTAGRAM_FEED" ? (
              (["hook", "body", "cta", "hashtags"] as (keyof InstagramParts)[]).map((field, i, arr) => (
                <div
                  key={field}
                  className={`flex flex-col gap-1 ${i < arr.length - 1 ? "border-b border-zinc-100 pb-3" : ""}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-zinc-500">{FIELD_LABELS[field]}</span>
                    <button
                      onClick={() => regenerateField(field)}
                      disabled={busy}
                      className="rounded-full border border-zinc-200 px-2 py-0.5 text-[11px] font-medium text-zinc-500 hover:bg-zinc-100 disabled:opacity-50"
                    >
                      {regeneratingField === field
                        ? "재생성 중..."
                        : `부분 재생성 (${OPERATION_CREDIT_COST.PARAGRAPH_REGENERATE} 크레딧)`}
                    </button>
                  </div>
                  <textarea
                    rows={field === "body" ? 5 : 2}
                    value={(parts as InstagramParts)[field]}
                    onChange={(e) => {
                      setParts((prev) => ({ ...(prev as InstagramParts), [field]: e.target.value }));
                      setDirty(true);
                    }}
                    className="rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-900"
                  />
                </div>
              ))
            ) : (
              (parts as ThreadsParts).posts.map((post, i, arr) => (
                <div
                  key={i}
                  className={`flex flex-col gap-1 ${i < arr.length - 1 ? "border-b border-zinc-100 pb-3" : ""}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-zinc-500">게시물 {i + 1}</span>
                    <button
                      onClick={() => regenerateField("post", i)}
                      disabled={busy}
                      className="rounded-full border border-zinc-200 px-2 py-0.5 text-[11px] font-medium text-zinc-500 hover:bg-zinc-100 disabled:opacity-50"
                    >
                      {regeneratingField === `post-${i}`
                        ? "재생성 중..."
                        : `부분 재생성 (${OPERATION_CREDIT_COST.PARAGRAPH_REGENERATE} 크레딧)`}
                    </button>
                  </div>
                  <textarea
                    rows={3}
                    value={post}
                    onChange={(e) => {
                      setParts((prev) => {
                        const next = [...(prev as ThreadsParts).posts];
                        next[i] = e.target.value;
                        return { posts: next };
                      });
                      setDirty(true);
                    }}
                    className="rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-900"
                  />
                </div>
              ))
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={save}
              disabled={busy || !dirty}
              className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-40"
            >
              {saving ? "저장 중..." : savedId ? "수정 저장" : "저장"}
            </button>
            <button
              onClick={copy}
              disabled={busy}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
            >
              {copied ? "복사됨" : "전체 복사"}
            </button>
            <button
              onClick={runAiGuideCheck}
              disabled={busy}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
            >
              {checkingAi ? "검사 중..." : `AI 가이드 검사 (${OPERATION_CREDIT_COST.GUIDE_CHECK} 크레딧)`}
            </button>
            <Toast message={toastMessage} />
          </div>

          {(guideItems.length > 0 || aiCheckNotes) && (
            <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4">
              <p className="text-xs font-semibold text-zinc-500">가이드 검사 결과</p>
              {guideItems.length > 0 && (
                <div>
                  <GuideCheckList items={guideItems} />
                  <p className="mt-1.5 text-[11px] text-zinc-400">{deterministicCheck?.charCount}자</p>
                </div>
              )}
              {aiCheckNotes && (
                <div className="border-t border-zinc-100 pt-3">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-amber-600">
                    <span aria-hidden>△</span> AI 세부 검토 의견
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-xs text-zinc-600">{aiCheckNotes}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {!hasContent && !loading && (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-6 py-8 text-center">
          <p className="text-sm text-zinc-500">
            아직 작성된 {PLATFORM_LABELS[platform]} 콘텐츠가 없습니다. &quot;생성&quot;을 눌러 시작하세요.
          </p>
        </div>
      )}
      {!hasContent && loading && (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-6 py-8 text-center">
          <p className="text-sm text-zinc-500">{PLATFORM_LABELS[platform]} 작성 중입니다. 잠시만 기다려주세요...</p>
        </div>
      )}
    </div>
  );
});
