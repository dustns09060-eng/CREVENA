"use client";

import { forwardRef, useImperativeHandle, useMemo, useState } from "react";
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
import { checkContentDeterministic, isDeterministicCheckPassing } from "@/lib/content-guide-check";
import { CONTENT_STATUS_LABELS, CONTENT_STATUSES } from "@/lib/content-status";
import { saveContent, updateContent, updateContentStatus } from "./actions";
import { OPERATION_CREDIT_COST } from "@/lib/ai/credits";
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
  }
>(function PlatformPanel({ platform, collaborationId, collaborationInfo, reviewNotes, initial }, ref) {
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

  const hasContent = platform === "INSTAGRAM_FEED"
    ? Boolean((parts as InstagramParts).body)
    : (parts as ThreadsParts).posts.length > 0;

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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-zinc-900">{PLATFORM_LABELS[platform]}</h2>
          {loading && <span className="text-xs text-zinc-400">생성중...</span>}
          {!loading && savedId && !dirty && <span className="text-xs text-emerald-600">저장됨</span>}
          {!loading && dirty && <span className="text-xs text-amber-600">저장 안 됨</span>}
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
              disabled={loading}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {loading ? "생성중..." : hasContent ? "다시 생성" : "생성"}
            </button>
            <span className="text-[10px] text-zinc-400">{OPERATION_CREDIT_COST.CONTENT_GENERATE} 크레딧 사용</span>
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {hasContent && (
        <div className="flex flex-col gap-4">
          {platform === "INSTAGRAM_FEED" ? (
            (["hook", "body", "cta", "hashtags"] as (keyof InstagramParts)[]).map((field) => (
              <div key={field} className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-500">
                    {{ hook: "후킹 문구", body: "본문", cta: "CTA", hashtags: "해시태그" }[field]}
                  </span>
                  <button
                    onClick={() => regenerateField(field)}
                    disabled={regeneratingField === field}
                    className="text-xs text-zinc-500 hover:text-zinc-900 hover:underline disabled:opacity-50"
                  >
                    {regeneratingField === field
                      ? "재생성중..."
                      : `이 부분만 재생성 (${OPERATION_CREDIT_COST.PARAGRAPH_REGENERATE} 크레딧)`}
                  </button>
                </div>
                <textarea
                  rows={field === "body" ? 5 : 2}
                  value={(parts as InstagramParts)[field]}
                  onChange={(e) => {
                    setParts((prev) => ({ ...(prev as InstagramParts), [field]: e.target.value }));
                    setDirty(true);
                  }}
                  className="rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-900"
                />
              </div>
            ))
          ) : (
            (parts as ThreadsParts).posts.map((post, i) => (
              <div key={i} className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-500">포스트 {i + 1}</span>
                  <button
                    onClick={() => regenerateField("post", i)}
                    disabled={regeneratingField === `post-${i}`}
                    className="text-xs text-zinc-500 hover:text-zinc-900 hover:underline disabled:opacity-50"
                  >
                    {regeneratingField === `post-${i}`
                      ? "재생성중..."
                      : `이 포스트만 재생성 (${OPERATION_CREDIT_COST.PARAGRAPH_REGENERATE} 크레딧)`}
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
                  className="rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-900"
                />
              </div>
            ))
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={save}
              disabled={saving || !dirty}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
            >
              {saving ? "저장중..." : savedId ? "수정 저장" : "저장"}
            </button>
            <button
              onClick={copy}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
            >
              {copied ? "복사됨" : "전체 복사"}
            </button>
            <button
              onClick={runAiGuideCheck}
              disabled={checkingAi}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
            >
              {checkingAi ? "검사중..." : `AI 가이드 검사 (${OPERATION_CREDIT_COST.GUIDE_CHECK} 크레딧)`}
            </button>
          </div>

          {deterministicCheck && (
            <div
              className={`rounded-lg border px-3 py-2 text-xs ${
                isDeterministicCheckPassing(deterministicCheck)
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-amber-200 bg-amber-50 text-amber-800"
              }`}
            >
              <p className="font-medium">
                {isDeterministicCheckPassing(deterministicCheck) ? "가이드 항목 충족" : "가이드 항목 일부 미충족"}
                {" · "}
                {deterministicCheck.charCount}자
              </p>
              {deterministicCheck.missingKeywords.length > 0 && (
                <p>누락된 필수 키워드: {deterministicCheck.missingKeywords.join(", ")}</p>
              )}
              {deterministicCheck.missingHashtags.length > 0 && (
                <p>누락된 필수 해시태그: {deterministicCheck.missingHashtags.join(", ")}</p>
              )}
              {deterministicCheck.missingMentions.length > 0 && (
                <p>누락된 필수 계정 태그: {deterministicCheck.missingMentions.join(", ")}</p>
              )}
              {deterministicCheck.hasAdDisclosure === false && <p>광고 표시 문구가 포함되지 않았습니다.</p>}
            </div>
          )}

          {aiCheckNotes && (
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700">
              <p className="font-medium text-zinc-900">AI 가이드 검사 결과</p>
              <p className="mt-1 whitespace-pre-wrap">{aiCheckNotes}</p>
            </div>
          )}
        </div>
      )}

      {!hasContent && !loading && (
        <p className="text-sm text-zinc-400">아직 생성된 콘텐츠가 없습니다. &quot;생성&quot;을 눌러주세요.</p>
      )}
    </div>
  );
});
