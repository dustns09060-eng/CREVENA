"use client";

import { useRef, useState } from "react";
import { PhotoBlogStudio, type PhotoBlogStudioHandle } from "../photos/PhotoBlogStudio";
import { PlatformPanel, type PlatformPanelHandle, type PlatformParts } from "./PlatformPanel";
import { SectionHeader, OptionalTag, PlatformStatusPill, type PlatformStatus } from "./studio-ui";
import { updateReviewNotes } from "@/lib/actions/review-notes";
import { OPERATION_CREDIT_COST } from "@/lib/ai/credits";
import type { ContentGenerationInput, ReviewNotes } from "@/lib/ai/prompts";
import type { CollaborationPhoto, ContentStatus, PhotoType } from "@/types/database";

type PhotoWithUrl = CollaborationPhoto & { fullUrl: string; thumbUrl: string };

const REVIEW_NOTE_FIELDS: { key: keyof ReviewNotes; label: string; required?: boolean }[] = [
  { key: "actualReview", label: "실제 사용 후기", required: true },
  { key: "pros", label: "좋았던 점" },
  { key: "cons", label: "아쉬웠던 점" },
  { key: "kidsReaction", label: "아이 반응" },
  { key: "usageLocation", label: "사용 장소" },
  { key: "usageSituation", label: "사용 상황" },
  { key: "photoDescription", label: "사진 설명" },
  { key: "personalExperience", label: "개인적인 경험" },
];

type StudioPlatform = "BLOG" | "INSTAGRAM_FEED" | "THREADS";
type TabKey = StudioPlatform | "REELS";

const TABS: { key: TabKey; label: string }[] = [
  { key: "BLOG", label: "블로그" },
  { key: "INSTAGRAM_FEED", label: "Instagram" },
  { key: "THREADS", label: "Threads" },
  { key: "REELS", label: "Reels" },
];

export function StudioTabs({
  collaborationId,
  collaborationInfo,
  photoBlogInfo,
  initialPhotos,
  initialReviewNotes,
  initialInstagram,
  initialThreads,
}: {
  collaborationId: string;
  collaborationInfo: Omit<ContentGenerationInput, "reviewNotes">;
  photoBlogInfo: {
    brandName: string;
    productName: string;
    campaignName: string | null;
    requiredKeywords: string | null;
    requiredHashtags: string | null;
    adDisclosureText: string | null;
    contentGuide: string | null;
    guideRawContent: string | null;
    requiredPhotoCount: number | null;
    styleSamples: { styleName: string; sampleText: string }[];
  };
  initialPhotos: PhotoWithUrl[];
  initialReviewNotes: ReviewNotes;
  initialInstagram?: { id: string; body: string; status: ContentStatus; generationInput: PlatformParts | null };
  initialThreads?: { id: string; body: string; status: ContentStatus; generationInput: PlatformParts | null };
}) {
  const [tab, setTab] = useState<TabKey>("BLOG");
  const [reviewNotes, setReviewNotes] = useState<ReviewNotes>(initialReviewNotes);
  const [photoCount, setPhotoCount] = useState(initialPhotos.length);
  const [selected, setSelected] = useState<Record<StudioPlatform, boolean>>({
    BLOG: true,
    INSTAGRAM_FEED: true,
    THREADS: true,
  });
  const [platformStatus, setPlatformStatus] = useState<Record<StudioPlatform, PlatformStatus>>({
    BLOG: initialPhotos.length > 0 && photoBlogInfo ? "EMPTY" : "EMPTY",
    INSTAGRAM_FEED: initialInstagram ? "DONE" : "EMPTY",
    THREADS: initialThreads ? "DONE" : "EMPTY",
  });
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);

  const blogRef = useRef<PhotoBlogStudioHandle>(null);
  const igRef = useRef<PlatformPanelHandle>(null);
  const threadsRef = useRef<PlatformPanelHandle>(null);

  function handleReviewNoteBlur(key: keyof ReviewNotes, value: string) {
    updateReviewNotes(collaborationId, { ...reviewNotes, [key]: value });
  }

  function setStatus(platform: StudioPlatform, status: PlatformStatus) {
    setPlatformStatus((prev) => (prev[platform] === status ? prev : { ...prev, [platform]: status }));
  }

  // Client-side estimate only, purely informational — it mirrors the fixed
  // per-operation costs in src/lib/ai/credits.ts (never sent to the server;
  // the actual charge is always computed server-side per route, unchanged).
  const estimatedCredits =
    (selected.BLOG && photoCount > 0 ? OPERATION_CREDIT_COST.BLOG_WRITE : 0) +
    (selected.INSTAGRAM_FEED ? OPERATION_CREDIT_COST.CONTENT_GENERATE : 0) +
    (selected.THREADS ? OPERATION_CREDIT_COST.CONTENT_GENERATE : 0);
  const selectedCount = (["BLOG", "INSTAGRAM_FEED", "THREADS"] as const).filter((k) => selected[k]).length;

  // Each platform's generate() is called independently (Promise.allSettled),
  // never merged into one prompt — a failure on one platform must never
  // block or roll back the others (STEP33 요구사항: 실패 격리).
  async function runBulkGenerate() {
    setBulkRunning(true);
    setBulkResult(null);
    const jobs: { label: string; run: () => Promise<void> }[] = [];
    if (selected.BLOG) {
      if (photoCount === 0) {
        setBulkResult((prev) => `${prev ?? ""}블로그: 사진이 없어 건너뜀. `);
      } else {
        jobs.push({ label: "블로그", run: () => blogRef.current!.generate() });
      }
    }
    if (selected.INSTAGRAM_FEED) jobs.push({ label: "Instagram", run: () => igRef.current!.generate() });
    if (selected.THREADS) jobs.push({ label: "Threads", run: () => threadsRef.current!.generate() });

    const results = await Promise.allSettled(jobs.map((j) => j.run()));
    const summary = results
      .map((r, i) => `${jobs[i].label}: ${r.status === "fulfilled" ? "성공" : "실패"}`)
      .join(" · ");
    setBulkResult((prev) => `${prev ?? ""}${summary}`);
    setBulkRunning(false);
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ① 콘텐츠 정보 */}
      <section className="rounded-xl border border-zinc-200 bg-white p-4 sm:p-5">
        <SectionHeader
          step={1}
          title="콘텐츠 기본 정보"
          description="AI가 실제 경험이 담긴 콘텐츠를 만들 수 있도록 아래 내용을 입력해주세요."
        />
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {REVIEW_NOTE_FIELDS.map((field) => (
            <label key={field.key} className="flex flex-col gap-1 text-sm">
              <span className="flex items-center gap-1.5 font-medium text-zinc-700">
                {field.label}
                {!field.required && <OptionalTag />}
              </span>
              <textarea
                rows={2}
                value={reviewNotes[field.key] ?? ""}
                onChange={(e) => setReviewNotes((prev) => ({ ...prev, [field.key]: e.target.value }))}
                onBlur={(e) => handleReviewNoteBlur(field.key, e.target.value)}
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-900"
              />
            </label>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-zinc-400">
          이 정보는 블로그/Instagram/Threads 생성 시 공통으로 사용됩니다. 플랫폼마다 다시 입력할 필요가
          없습니다.
        </p>
      </section>

      {/* ③ AI 콘텐츠 생성 — 플랫폼 선택 및 일괄 생성 */}
      <section className="rounded-xl border border-zinc-200 bg-white p-4 sm:p-5">
        <SectionHeader step={3} title="AI 콘텐츠 생성" description="만들고 싶은 플랫폼을 선택하세요." />
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {(["BLOG", "INSTAGRAM_FEED", "THREADS"] as const).map((key) => (
            <label
              key={key}
              className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                selected[key] ? "border-zinc-900 bg-zinc-50" : "border-zinc-200"
              }`}
            >
              <span className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selected[key]}
                  onChange={(e) => setSelected((prev) => ({ ...prev, [key]: e.target.checked }))}
                  className="h-4 w-4"
                />
                <span className="font-medium text-zinc-800">
                  {TABS.find((t) => t.key === key)!.label}
                </span>
              </span>
              <PlatformStatusPill status={platformStatus[key]} />
            </label>
          ))}
        </div>

        <div className="mt-4 flex flex-col gap-2 border-t border-zinc-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <PlatformStatusPill status="COMING_SOON" />
            <span>Reels — 영상 제작 기능은 다음 단계에서 제공됩니다.</span>
          </div>
          <div className="flex flex-col items-stretch gap-1 sm:items-end">
            <button
              onClick={runBulkGenerate}
              disabled={bulkRunning || selectedCount === 0}
              className="min-h-[44px] rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:bg-zinc-800 disabled:opacity-40"
            >
              {bulkRunning ? "선택 항목 생성 중..." : "선택 항목 한 번에 생성"}
            </button>
            {selectedCount > 0 && (
              <span className="text-[11px] text-zinc-400">예상 사용량 {estimatedCredits} 크레딧</span>
            )}
          </div>
        </div>
        {bulkRunning && (
          <p className="mt-3 rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
            {[
              selected.BLOG && photoCount > 0 && "블로그 작성 중...",
              selected.INSTAGRAM_FEED && "Instagram 작성 중...",
              selected.THREADS && "Threads 작성 중...",
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
        {!bulkRunning && bulkResult && (
          <p className="mt-3 rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600">{bulkResult}</p>
        )}
      </section>

      {/* ④ 결과 편집 — 플랫폼별 탭 */}
      <div className="flex flex-wrap gap-1 overflow-x-auto border-b border-zinc-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`shrink-0 rounded-t-lg px-4 py-2 text-sm font-medium ${
              tab === t.key ? "border-b-2 border-zinc-900 text-zinc-900" : "text-zinc-500 hover:text-zinc-900"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* All tab panels stay mounted (just hidden) so switching tabs never
          loses in-progress edits, and the bulk-generate refs above stay valid
          regardless of which tab is currently visible. */}
      <div className={tab === "BLOG" ? "" : "hidden"}>
        <PhotoBlogStudio
          ref={blogRef}
          collaborationId={collaborationId}
          initialPhotos={initialPhotos}
          reviewNotes={reviewNotes}
          collaborationInfo={photoBlogInfo}
          onPhotoCountChange={setPhotoCount}
          onStatusChange={(s) => setStatus("BLOG", s)}
        />
      </div>
      <div className={tab === "INSTAGRAM_FEED" ? "" : "hidden"}>
        <PlatformPanel
          ref={igRef}
          platform="INSTAGRAM_FEED"
          collaborationId={collaborationId}
          collaborationInfo={collaborationInfo}
          reviewNotes={reviewNotes}
          initial={initialInstagram}
          onStatusChange={(s) => setStatus("INSTAGRAM_FEED", s)}
        />
      </div>
      <div className={tab === "THREADS" ? "" : "hidden"}>
        <PlatformPanel
          ref={threadsRef}
          platform="THREADS"
          collaborationId={collaborationId}
          collaborationInfo={collaborationInfo}
          reviewNotes={reviewNotes}
          initial={initialThreads}
          onStatusChange={(s) => setStatus("THREADS", s)}
        />
      </div>
      <div className={tab === "REELS" ? "" : "hidden"}>
        <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-8 text-center text-sm text-zinc-500">
          Reels는 준비 중입니다 (Coming Soon). 영상 편집/업로드는 이번 단계 범위에 포함되지 않습니다.
        </div>
      </div>
    </div>
  );
}

// Re-exported so page.tsx doesn't need to import PhotoType separately just
// for the props type above.
export type { PhotoType };
