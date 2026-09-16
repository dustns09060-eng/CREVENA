"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  buildContentPrompt,
  type ContentGenerationInput,
  type ContentPlatformKey,
  type ReviewNotes,
} from "@/lib/ai/prompts";
import { UPLOAD_PLATFORM_LABELS } from "@/lib/upload-platforms";
import { CONTENT_STATUS_LABELS, CONTENT_STATUSES } from "@/lib/content-status";
import { saveContent, updateContent, updateContentStatus } from "./actions";
import { updateReviewNotes } from "@/lib/actions/review-notes";
import { OPERATION_CREDIT_COST } from "@/lib/ai/credits";
import type { ContentStatus } from "@/types/database";

const PLATFORMS: ContentPlatformKey[] = ["INSTAGRAM_FEED", "NAVER_BLOG", "THREADS"];

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

type PlatformState = {
  loading: boolean;
  saving: boolean;
  content: string;
  error: string | null;
  copied: boolean;
  savedId: string | null;
  status: ContentStatus;
  dirty: boolean;
};

function emptyPlatformState(initial?: { id: string; body: string; status: ContentStatus }): PlatformState {
  return {
    loading: false,
    saving: false,
    content: initial?.body ?? "",
    error: null,
    copied: false,
    savedId: initial?.id ?? null,
    status: initial?.status ?? "DRAFT",
    dirty: false,
  };
}

export function ContentStudio({
  collaborationId,
  collaborationInfo,
  initialContents,
  initialReviewNotes,
}: {
  collaborationId: string;
  collaborationInfo: Omit<ContentGenerationInput, "reviewNotes">;
  initialContents: Partial<Record<ContentPlatformKey, { id: string; body: string; status: ContentStatus }>>;
  initialReviewNotes: ReviewNotes;
}) {
  const router = useRouter();
  const [reviewNotes, setReviewNotes] = useState<ReviewNotes>(initialReviewNotes);

  function handleReviewNoteBlur(key: keyof ReviewNotes, value: string) {
    updateReviewNotes(collaborationId, { ...reviewNotes, [key]: value });
  }
  const [results, setResults] = useState<Record<ContentPlatformKey, PlatformState>>({
    INSTAGRAM_FEED: emptyPlatformState(initialContents.INSTAGRAM_FEED),
    NAVER_BLOG: emptyPlatformState(initialContents.NAVER_BLOG),
    THREADS: emptyPlatformState(initialContents.THREADS),
  });

  const hasUnsavedContent = Object.values(results).some((r) => r.dirty);
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (!hasUnsavedContent) return;
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedContent]);

  function patch(platform: ContentPlatformKey, updates: Partial<PlatformState>) {
    setResults((prev) => ({ ...prev, [platform]: { ...prev[platform], ...updates } }));
  }

  async function generate(platform: ContentPlatformKey) {
    patch(platform, { loading: true, error: null });

    const { systemPrompt, prompt } = buildContentPrompt(platform, {
      ...collaborationInfo,
      reviewNotes,
    });

    try {
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, systemPrompt, operation: "CONTENT_GENERATE" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "생성에 실패했습니다.");
      patch(platform, {
        loading: false,
        content: data.content,
        copied: false,
        savedId: null,
        status: "DRAFT",
        dirty: true,
      });
      router.refresh();
    } catch (err) {
      patch(platform, {
        loading: false,
        error: err instanceof Error ? err.message : "생성에 실패했습니다.",
      });
    }
  }

  async function copy(platform: ContentPlatformKey) {
    await navigator.clipboard.writeText(results[platform].content);
    patch(platform, { copied: true });
  }

  async function save(platform: ContentPlatformKey) {
    const state = results[platform];
    patch(platform, { saving: true, error: null });

    const result = state.savedId
      ? await updateContent({ contentId: state.savedId, collaborationId, body: state.content })
      : await saveContent({ collaborationId, platform, body: state.content });

    if ("error" in result) {
      patch(platform, { saving: false, error: result.error });
      return;
    }
    patch(platform, { saving: false, savedId: result.id, dirty: false });
  }

  async function changeStatus(platform: ContentPlatformKey, status: ContentStatus) {
    const state = results[platform];
    if (!state.savedId) return;
    const prevStatus = state.status;
    patch(platform, { status });
    const result = await updateContentStatus({
      contentId: state.savedId,
      collaborationId,
      status,
    });
    if ("error" in result) {
      patch(platform, { status: prevStatus, error: result.error });
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-xl border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-zinc-900">후기 메모</h2>
        <p className="mt-1 text-xs text-zinc-500">
          입력한 내용만 콘텐츠에 반영됩니다. 사실이 아닌 내용은 지어내지 않습니다. 자동
          저장되며, 사진 기반 블로그 작성 화면과 공유됩니다.
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

      {PLATFORMS.map((platform) => {
        const state = results[platform];
        return (
          <section key={platform} className="rounded-xl border border-zinc-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-zinc-900">
                {UPLOAD_PLATFORM_LABELS[platform]}
              </h2>
              <div className="flex items-center gap-2">
                {state.savedId && (
                  <select
                    value={state.status}
                    onChange={(e) => changeStatus(platform, e.target.value as ContentStatus)}
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
                    onClick={() => generate(platform)}
                    disabled={state.loading}
                    className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {state.loading ? "생성중..." : "생성"}
                  </button>
                  <span className="text-[10px] text-zinc-400">
                    {OPERATION_CREDIT_COST.CONTENT_GENERATE} 크레딧 사용
                  </span>
                </div>
              </div>
            </div>

            {state.error && <p className="mt-3 text-sm text-red-600">{state.error}</p>}

            {state.content && (
              <div className="mt-3 flex flex-col gap-2">
                <textarea
                  rows={10}
                  value={state.content}
                  onChange={(e) =>
                    patch(platform, { content: e.target.value, copied: false, dirty: true })
                  }
                  className="rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-900"
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => save(platform)}
                    disabled={state.saving || !state.dirty}
                    className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
                  >
                    {state.saving ? "저장중..." : state.savedId ? "수정 저장" : "저장"}
                  </button>
                  <button
                    onClick={() => copy(platform)}
                    className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
                  >
                    {state.copied ? "복사됨" : "복사"}
                  </button>
                  {state.savedId && !state.dirty && (
                    <span className="text-xs text-emerald-600">저장됨</span>
                  )}
                </div>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
