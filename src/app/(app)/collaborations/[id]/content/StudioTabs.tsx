"use client";

import { useRef, useState } from "react";
import { PhotoBlogStudio, type PhotoBlogStudioHandle } from "../photos/PhotoBlogStudio";
import { usePhotoManager } from "../photos/usePhotoManager";
import { PhotoSection } from "./PhotoSection";
import { PlatformPanel, type PlatformPanelHandle, type PlatformParts } from "./PlatformPanel";
import { GuideAnalysisCard } from "./GuideAnalysisCard";
import { ReelsStudio } from "../reels/ReelsStudio";
import type { VideoWithUrl } from "../reels/useVideoManager";
import type { ReelsProject } from "../reels/actions";
import { CarouselStudio } from "../carousel/CarouselStudio";
import type { CarouselProject } from "../carousel/actions";
import {
  SectionHeader,
  Accordion,
  OptionalTag,
  PlatformStatusPill,
  ProgressList,
  type PlatformStatus,
  type ProgressStep,
} from "./studio-ui";
import { updateReviewNotes } from "@/lib/actions/review-notes";
import { updateGuideRawContent } from "@/lib/actions/guide";
import { getRemainingCredits } from "@/lib/actions/usage";
import { OPERATION_CREDIT_COST } from "@/lib/ai/credits";
import type { BlogMeta } from "../photos/actions";
import { buildGuideAnalysisPrompt, type GuideAnalysis } from "@/lib/ai/guide-analysis-prompts";
import { parseJsonResponse } from "@/lib/ai/photo-blog-prompts";
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

type StudioPlatform = "BLOG" | "INSTAGRAM_FEED" | "THREADS";
type TabKey = StudioPlatform | "REELS" | "CAROUSEL";

const TABS: { key: TabKey; label: string }[] = [
  { key: "BLOG", label: "블로그" },
  { key: "INSTAGRAM_FEED", label: "Instagram" },
  { key: "THREADS", label: "Threads" },
  { key: "REELS", label: "Reels" },
  { key: "CAROUSEL", label: "카드뉴스" },
];

export function StudioTabs({
  collaborationId,
  collaborationInfo,
  photoBlogInfo,
  initialPhotos,
  initialGuideRawContent,
  initialReviewNotes,
  initialInstagram,
  initialThreads,
  initialBlog,
  initialVideos,
  initialReels,
  initialCarousel,
}: {
  collaborationId: string;
  collaborationInfo: Omit<ContentGenerationInput, "reviewNotes">;
  photoBlogInfo: {
    brandName: string;
    productName: string;
    campaignName: string | null;
    requiredKeywords: string | null;
    requiredHashtags: string | null;
    requiredMentions?: string | null;
    adDisclosureText: string | null;
    contentGuide: string | null;
    guideRawContent: string | null;
    requiredPhotoCount: number | null;
    styleSamples: { styleName: string; sampleText: string }[];
  };
  initialPhotos: PhotoWithUrl[];
  initialGuideRawContent: string;
  initialReviewNotes: ReviewNotes;
  initialInstagram?: { id: string; body: string; status: ContentStatus; generationInput: PlatformParts | null };
  initialThreads?: { id: string; body: string; status: ContentStatus; generationInput: PlatformParts | null };
  initialBlog?: { id: string; body: string; generationInput: BlogMeta | null };
  initialVideos: VideoWithUrl[];
  initialReels?: { id: string; generationInput: ReelsProject | null };
  initialCarousel?: { id: string; generationInput: CarouselProject | null };
}) {
  const [tab, setTab] = useState<TabKey>("BLOG");
  const [reviewNotes, setReviewNotes] = useState<ReviewNotes>(initialReviewNotes);
  const [guideText, setGuideText] = useState(initialGuideRawContent);
  const [guideAnalysis, setGuideAnalysis] = useState<GuideAnalysis | null>(null);
  // STEP36 item 6: the exact guide text guideAnalysis was computed from, so
  // editing the guide afterward can be flagged as "stale" (△) without ever
  // silently deleting the existing analysis result.
  const [guideAnalyzedText, setGuideAnalyzedText] = useState<string | null>(null);
  const [guideError, setGuideError] = useState<string | null>(null);
  const guideStale = guideAnalysis !== null && guideText !== guideAnalyzedText;
  const photoManager = usePhotoManager(collaborationId, initialPhotos);
  const [selected, setSelected] = useState<Record<StudioPlatform, boolean>>({
    BLOG: true,
    INSTAGRAM_FEED: true,
    THREADS: true,
  });
  const [platformStatus, setPlatformStatus] = useState<Record<StudioPlatform, PlatformStatus>>({
    BLOG: initialBlog?.generationInput ? "DONE" : "EMPTY",
    INSTAGRAM_FEED: initialInstagram ? "DONE" : "EMPTY",
    THREADS: initialThreads ? "DONE" : "EMPTY",
  });
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [progressSteps, setProgressSteps] = useState<ProgressStep[]>([]);
  const [pipelineSummary, setPipelineSummary] = useState<string | null>(null);
  const [budgetWarning, setBudgetWarning] = useState<string | null>(null);
  const [checkingBudget, setCheckingBudget] = useState(false);

  const blogRef = useRef<PhotoBlogStudioHandle>(null);
  const igRef = useRef<PlatformPanelHandle>(null);
  const threadsRef = useRef<PlatformPanelHandle>(null);
  // STEP36 item 22: `pipelineRunning` state alone isn't enough — a second
  // click can fire before React re-renders with the disabled button, so a
  // synchronous ref is checked first to guarantee only one run starts.
  const pipelineRunningRef = useRef(false);

  function handleReviewNoteBlur(key: keyof ReviewNotes, value: string) {
    updateReviewNotes(collaborationId, { ...reviewNotes, [key]: value });
  }

  function handleGuideBlur(value: string) {
    if (value === initialGuideRawContent) return;
    updateGuideRawContent(collaborationId, value);
  }

  function setStatus(platform: StudioPlatform, status: PlatformStatus) {
    setPlatformStatus((prev) => (prev[platform] === status ? prev : { ...prev, [platform]: status }));
  }

  async function analyzeGuide(): Promise<void> {
    if (!guideText.trim()) return;
    setGuideError(null);
    const analyzedText = guideText;
    try {
      const { systemPrompt, prompt, responseSchema } = buildGuideAnalysisPrompt(guideText);
      const res = await fetch("/api/ai/analyze-guide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemPrompt, prompt, responseSchema, collaborationId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "가이드 분석에 실패했습니다.");
      const parsed = parseJsonResponse<GuideAnalysis>(data.content);
      setGuideAnalysis(parsed);
      setGuideAnalyzedText(analyzedText);
    } catch (err) {
      setGuideError(err instanceof Error ? err.message : "가이드 분석에 실패했습니다.");
      throw err;
    }
  }

  const unanalyzedPhotoCount = photoManager.photos.filter((p) => !p.ai_analysis).length;

  // Client-side estimate only, purely informational — mirrors the fixed
  // per-operation costs in src/lib/ai/credits.ts. The server independently
  // computes and charges the real cost per call; this number never travels
  // to the server and can never change what gets charged (STEP35.5 item 18).
  const estimatedCredits =
    (guideText.trim() && !guideAnalysis ? OPERATION_CREDIT_COST.GUIDE_ANALYZE : 0) +
    unanalyzedPhotoCount * OPERATION_CREDIT_COST.PHOTO_ANALYSIS +
    (photoManager.photos.length >= 2 ? OPERATION_CREDIT_COST.ORDER_SUGGEST : 0) +
    (selected.BLOG && photoManager.photos.length > 0 ? OPERATION_CREDIT_COST.BLOG_WRITE : 0) +
    (selected.INSTAGRAM_FEED ? OPERATION_CREDIT_COST.CONTENT_GENERATE : 0) +
    (selected.THREADS ? OPERATION_CREDIT_COST.CONTENT_GENERATE : 0);
  const selectedCount = (["BLOG", "INSTAGRAM_FEED", "THREADS"] as const).filter((k) => selected[k]).length;

  // STEP35.5 item 15/16/17: one-click orchestration. Every step below just
  // calls an existing, already-tested function (photoManager.*, each
  // platform panel's exposed generate()) — no new AI call sites beyond guide
  // analysis. A step failing never stops the pipeline or discards another
  // step's success; Promise.allSettled still isolates platform generation
  // exactly as STEP33 already guaranteed.
  // STEP36 item 5: before actually starting, check the SERVER-authoritative
  // remaining balance (never the client-side estimate above, and never the
  // sidebar UsageBadge — both are informational only) and warn the user if
  // this run's estimate exceeds it. The estimate itself never changes what
  // gets charged; only the existing per-call server checks do that.
  async function handleStartClick() {
    if (pipelineRunningRef.current || checkingBudget) return;
    if (budgetWarning) {
      // Second click: user already saw the warning and chose to proceed.
      setBudgetWarning(null);
      await runOneClickPipeline();
      return;
    }
    setCheckingBudget(true);
    try {
      const remainingInfo = await getRemainingCredits();
      if (remainingInfo && estimatedCredits > remainingInfo.remaining) {
        setBudgetWarning(
          `현재 ${remainingInfo.remaining}크레딧이 남아 있고 이 작업에는 최대 ${estimatedCredits}크레딧이 필요합니다. 일부 단계가 크레딧 부족으로 중간에 실패할 수 있습니다. 플랫폼 선택을 줄이거나 요금제를 업그레이드할 수 있어요. 그래도 진행하시겠습니까?`,
        );
        return;
      }
    } finally {
      setCheckingBudget(false);
    }
    await runOneClickPipeline();
  }

  async function runOneClickPipeline() {
    if (pipelineRunningRef.current) return;
    pipelineRunningRef.current = true;
    setPipelineRunning(true);
    setPipelineSummary(null);

    const steps: ProgressStep[] = [
      { key: "guide", label: "가이드 분석 중...", state: "pending" },
      { key: "photoAnalyze", label: "사진 분석 중...", state: "pending" },
      { key: "photoOrder", label: "사진 순서 정리 중...", state: "pending" },
    ];
    if (selected.BLOG) steps.push({ key: "blog", label: "블로그 작성 중...", state: "pending" });
    if (selected.INSTAGRAM_FEED) steps.push({ key: "instagram", label: "Instagram 작성 중...", state: "pending" });
    if (selected.THREADS) steps.push({ key: "threads", label: "Threads 작성 중...", state: "pending" });
    steps.push({ key: "guideCheck", label: "가이드 확인 중...", state: "pending" });
    steps.push({ key: "result", label: "콘텐츠 제작 완료", state: "pending" });
    setProgressSteps(steps);

    const update = (key: string, state: ProgressStep["state"], detail?: string) =>
      setProgressSteps((prev) => prev.map((s) => (s.key === key ? { ...s, state, detail } : s)));

    // STEP A: 가이드 분석
    if (guideText.trim()) {
      if (guideAnalysis && !guideStale) {
        update("guide", "done", "(이미 분석됨)");
      } else {
        update("guide", "active");
        try {
          await analyzeGuide();
          update("guide", "done");
        } catch {
          update("guide", "failed");
        }
      }
    } else {
      update("guide", "skipped");
    }

    // STEP B: 미분석 사진 분석 (이미 분석된 사진은 다시 분석하지 않음)
    if (unanalyzedPhotoCount > 0) {
      update("photoAnalyze", "active", `0/${unanalyzedPhotoCount}`);
      try {
        await photoManager.handleAnalyzeAll();
        update("photoAnalyze", "done");
      } catch {
        update("photoAnalyze", "failed");
      }
    } else {
      update("photoAnalyze", "skipped");
    }

    // STEP C: 사진 순서/대표사진 추천
    if (photoManager.photos.length >= 2) {
      update("photoOrder", "active");
      try {
        await photoManager.handleSuggestOrder(guideAnalysis?.minimumPhotos);
        update("photoOrder", "done");
      } catch {
        update("photoOrder", "failed");
      }
    } else {
      update("photoOrder", "skipped");
    }

    // STEP D: 선택한 플랫폼 콘텐츠 생성 — Promise.allSettled로 서로 격리.
    const jobs: { key: string; label: string; run: () => Promise<void> }[] = [];
    if (selected.BLOG) {
      if (photoManager.photos.length === 0) {
        update("blog", "skipped", "(사진 없음)");
      } else {
        update("blog", "active");
        jobs.push({ key: "blog", label: "블로그", run: () => blogRef.current!.generate() });
      }
    }
    if (selected.INSTAGRAM_FEED) {
      update("instagram", "active");
      jobs.push({ key: "instagram", label: "Instagram", run: () => igRef.current!.generate() });
    }
    if (selected.THREADS) {
      update("threads", "active");
      jobs.push({ key: "threads", label: "Threads", run: () => threadsRef.current!.generate() });
    }

    const results = await Promise.allSettled(jobs.map((j) => j.run()));
    results.forEach((r, i) => update(jobs[i].key, r.status === "fulfilled" ? "done" : "failed"));
    setPipelineSummary(
      jobs.map((j, i) => `${j.label}: ${results[i].status === "fulfilled" ? "성공" : "실패"}`).join(" · "),
    );

    // STEP E: 가이드 준수 자동 검사 — 결정론적 검사는 각 결과 패널에서 이미
    // 실시간으로(추가 크레딧 없이) 계산되어 표시된다.
    update("guideCheck", "done");

    // STEP F: 결과 화면 표시
    update("result", "done");

    pipelineRunningRef.current = false;
    setPipelineRunning(false);
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ① 업체 가이드 */}
      <section className="rounded-xl border border-zinc-200 bg-white p-4 sm:p-5">
        <SectionHeader
          step={1}
          title="업체 가이드라인"
          description="업체에서 받은 체험단 가이드를 그대로 복사해서 붙여넣으세요. CREVENA가 필수 키워드, 문구, 사진 조건 등을 자동으로 분석합니다."
        />
        <textarea
          rows={6}
          placeholder="가이드라인을 여기에 그대로 붙여넣어 주세요"
          value={guideText}
          onChange={(e) => setGuideText(e.target.value)}
          onBlur={(e) => handleGuideBlur(e.target.value)}
          className="mt-3 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-900"
        />
        {guideError && (
          <p className="mt-2 whitespace-pre-wrap rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {guideError}
          </p>
        )}
        {guideAnalysis && (
          <div className="mt-3">
            {guideStale && (
              <p className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                △ 가이드 내용이 수정되었습니다. 분석 결과가 최신 내용을 반영하지 못했을 수 있어요 — &quot;AI
                콘텐츠 만들기&quot;를 다시 실행하면 자동으로 재분석됩니다.
              </p>
            )}
            <GuideAnalysisCard analysis={guideAnalysis} onChange={setGuideAnalysis} />
          </div>
        )}
      </section>

      {/* ② 사진 준비 */}
      <PhotoSection
        manager={photoManager}
        requiredPhotoCount={photoBlogInfo.requiredPhotoCount}
        minimumPhotos={guideAnalysis?.minimumPhotos}
      />

      {/* ③ 내 경험 추가하기 (선택) */}
      <Accordion title="내 경험 추가하기" description="선택 입력 — 비워둬도 생성할 수 있습니다">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {REVIEW_NOTE_FIELDS.map((field) => (
            <label key={field.key} className="flex flex-col gap-1 text-sm">
              <span className="flex items-center gap-1.5 font-medium text-zinc-700">
                {field.label}
                <OptionalTag />
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
      </Accordion>

      {/* ④ 제작할 콘텐츠 선택 + ⑤ AI 콘텐츠 만들기 */}
      <section className="rounded-xl border border-zinc-200 bg-white p-4 sm:p-5">
        <SectionHeader step={4} title="제작할 콘텐츠 선택" description="만들고 싶은 플랫폼을 선택하세요." />
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
                <span className="font-medium text-zinc-800">{TABS.find((t) => t.key === key)!.label}</span>
              </span>
              <PlatformStatusPill status={platformStatus[key]} />
            </label>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2 text-xs text-zinc-500">
          <span>Reels는 아래 &quot;Reels&quot; 탭에서 별도로 만들 수 있습니다 (AI 콘텐츠 만들기 일괄 생성에는 아직 포함되지 않습니다).</span>
        </div>

        <div className="mt-5 flex flex-col items-stretch gap-1 border-t border-zinc-100 pt-4">
          <SectionHeader step={5} title="AI 콘텐츠 만들기" />
          {budgetWarning && (
            <p className="mb-1 whitespace-pre-wrap rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {budgetWarning}
            </p>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={handleStartClick}
              disabled={pipelineRunning || checkingBudget || selectedCount === 0}
              className="mt-2 min-h-[48px] flex-1 rounded-lg bg-zinc-900 px-5 py-3 text-base font-semibold text-white transition-opacity hover:bg-zinc-800 disabled:opacity-40"
            >
              {pipelineRunning
                ? "콘텐츠 만드는 중..."
                : checkingBudget
                  ? "크레딧 확인 중..."
                  : budgetWarning
                    ? "그래도 진행"
                    : "AI 콘텐츠 만들기"}
            </button>
            {budgetWarning && (
              <button
                onClick={() => setBudgetWarning(null)}
                className="mt-2 min-h-[48px] rounded-lg border border-zinc-300 px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
              >
                취소
              </button>
            )}
          </div>
          {selectedCount > 0 && (
            <span className="text-[11px] text-zinc-400">예상 사용량 {estimatedCredits} 크레딧</span>
          )}
        </div>
      </section>

      {/* ⑥ 생성 진행 상태 */}
      {progressSteps.length > 0 && (
        <section className="rounded-xl border border-zinc-200 bg-white p-4 sm:p-5">
          <SectionHeader step={6} title="생성 진행 상태" />
          <div className="mt-3">
            <ProgressList
              steps={progressSteps.map((s) =>
                s.key === "photoAnalyze" && s.state === "active" && photoManager.analyzeProgress
                  ? {
                      ...s,
                      detail: `${photoManager.analyzeProgress.done}/${photoManager.analyzeProgress.total}`,
                    }
                  : s,
              )}
            />
          </div>
          {pipelineSummary && <p className="mt-3 rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600">{pipelineSummary}</p>}
        </section>
      )}

      {/* ⑦ 결과 확인/편집 (+ ⑧ 최종 가이드 검사, ⑨ 저장/복사는 각 결과 패널 하단에 포함) */}
      <section>
        <SectionHeader
          step={7}
          title="결과 확인/편집"
          description="플랫폼별 결과를 확인하고 필요한 부분만 고쳐보세요. 각 결과 하단에서 가이드 충족 여부(✓/△/✕)를 바로 확인할 수 있습니다."
        />
        <div className="mt-3 flex flex-wrap gap-1 overflow-x-auto border-b border-zinc-200">
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
            loses in-progress edits, and the one-click refs above stay valid
            regardless of which tab is currently visible. */}
        <div className={`mt-4 ${tab === "BLOG" ? "" : "hidden"}`}>
          <PhotoBlogStudio
            ref={blogRef}
            collaborationId={collaborationId}
            photoManager={photoManager}
            reviewNotes={reviewNotes}
            guideAnalysis={guideAnalysis}
            collaborationInfo={photoBlogInfo}
            initial={initialBlog}
            onStatusChange={(s) => setStatus("BLOG", s)}
          />
        </div>
        <div className={`mt-4 ${tab === "INSTAGRAM_FEED" ? "" : "hidden"}`}>
          <PlatformPanel
            ref={igRef}
            platform="INSTAGRAM_FEED"
            collaborationId={collaborationId}
            collaborationInfo={collaborationInfo}
            reviewNotes={reviewNotes}
            initial={initialInstagram}
            guideAnalysis={guideAnalysis}
            onStatusChange={(s) => setStatus("INSTAGRAM_FEED", s)}
          />
        </div>
        <div className={`mt-4 ${tab === "THREADS" ? "" : "hidden"}`}>
          <PlatformPanel
            ref={threadsRef}
            platform="THREADS"
            collaborationId={collaborationId}
            collaborationInfo={collaborationInfo}
            reviewNotes={reviewNotes}
            initial={initialThreads}
            guideAnalysis={guideAnalysis}
            onStatusChange={(s) => setStatus("THREADS", s)}
          />
        </div>
        <div className={`mt-4 ${tab === "REELS" ? "" : "hidden"}`}>
          <ReelsStudio
            collaborationId={collaborationId}
            photos={photoManager.photos.filter((p) => !photoManager.excludePhotoIds.has(p.id))}
            initialVideos={initialVideos}
            reviewNotes={reviewNotes}
            collaborationInfo={photoBlogInfo}
            initial={initialReels}
          />
        </div>
        <div className={`mt-4 ${tab === "CAROUSEL" ? "" : "hidden"}`}>
          <CarouselStudio
            collaborationId={collaborationId}
            photos={photoManager.photos.filter((p) => !photoManager.excludePhotoIds.has(p.id))}
            reviewNotes={reviewNotes}
            collaborationInfo={photoBlogInfo}
            guideAnalysis={guideAnalysis}
            initial={initialCarousel}
          />
        </div>
      </section>
    </div>
  );
}

// Re-exported so page.tsx doesn't need to import PhotoType separately just
// for the props type above.
export type { PhotoType };
