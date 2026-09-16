"use client";

import { useRef, useState } from "react";
import { PhotoBlogStudio, type PhotoBlogStudioHandle } from "../photos/PhotoBlogStudio";
import { PlatformPanel, type PlatformPanelHandle, type PlatformParts } from "./PlatformPanel";
import { updateReviewNotes } from "@/lib/actions/review-notes";
import type { ContentGenerationInput, ReviewNotes } from "@/lib/ai/prompts";
import type { CollaborationPhoto, ContentStatus, PhotoType } from "@/types/database";

type PhotoWithUrl = CollaborationPhoto & { fullUrl: string; thumbUrl: string };

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

type TabKey = "BLOG" | "INSTAGRAM_FEED" | "THREADS" | "REELS";

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
  const [selected, setSelected] = useState<Record<"BLOG" | "INSTAGRAM_FEED" | "THREADS", boolean>>({
    BLOG: true,
    INSTAGRAM_FEED: true,
    THREADS: true,
  });
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);

  const blogRef = useRef<PhotoBlogStudioHandle>(null);
  const igRef = useRef<PlatformPanelHandle>(null);
  const threadsRef = useRef<PlatformPanelHandle>(null);

  function handleReviewNoteBlur(key: keyof ReviewNotes, value: string) {
    updateReviewNotes(collaborationId, { ...reviewNotes, [key]: value });
  }

  // Each platform's generate() is called independently (Promise.allSettled),
  // never merged into one prompt — a failure on one platform must never
  // block or roll back the others (STEP33 요구사항: 실패 격리).
  async function runBulkGenerate() {
    setBulkRunning(true);
    setBulkResult(null);
    const jobs: { label: string; run: () => Promise<void> }[] = [];
    if (selected.BLOG) {
      if (initialPhotos.length === 0) {
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
      <section className="rounded-xl border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-zinc-900">후기 메모</h2>
        <p className="mt-1 text-xs text-zinc-500">
          모든 플랫폼(블로그/Instagram/Threads)이 이 메모와 협찬 정보를 공통으로 사용합니다. 같은 정보를
          플랫폼마다 다시 입력할 필요가 없습니다.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {REVIEW_NOTE_FIELDS.map((field) => (
            <label key={field.key} className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-zinc-700">{field.label}</span>
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
      </section>

      <section className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 bg-white p-4">
        <span className="text-sm font-medium text-zinc-700">한 번에 생성:</span>
        {(["BLOG", "INSTAGRAM_FEED", "THREADS"] as const).map((key) => (
          <label key={key} className="flex items-center gap-1.5 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={selected[key]}
              onChange={(e) => setSelected((prev) => ({ ...prev, [key]: e.target.checked }))}
            />
            {TABS.find((t) => t.key === key)!.label}
          </label>
        ))}
        <button
          onClick={runBulkGenerate}
          disabled={bulkRunning || !(selected.BLOG || selected.INSTAGRAM_FEED || selected.THREADS)}
          className="ml-auto rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {bulkRunning ? "생성중..." : "선택 항목 한 번에 생성"}
        </button>
        {bulkResult && <p className="w-full text-xs text-zinc-500">{bulkResult}</p>}
      </section>

      <div className="flex flex-wrap gap-1 border-b border-zinc-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-t-lg px-4 py-2 text-sm font-medium ${
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
          initialReviewNotes={initialReviewNotes}
          collaborationInfo={photoBlogInfo}
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
