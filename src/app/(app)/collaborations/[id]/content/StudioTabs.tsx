"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PhotoBlogStudio, type PhotoBlogStudioHandle } from "../photos/PhotoBlogStudio";
import { usePhotoManager } from "../photos/usePhotoManager";
import { PhotoSection } from "./PhotoSection";
import { PlatformPanel, type PlatformPanelHandle, type PlatformParts } from "./PlatformPanel";
import { GuideAnalysisCard } from "./GuideAnalysisCard";
import { saveContent } from "./actions";
import { ReelsStudio } from "../reels/ReelsStudio";
import type { VideoWithUrl } from "../reels/useVideoManager";
import { saveReelsProject, type ReelsProject } from "../reels/actions";
import { buildReelsProjectFromCarousel } from "../reels/from-carousel";
import { CarouselStudio } from "../carousel/CarouselStudio";
import { saveCarouselProject, type CarouselCard, type CarouselCardRole, type CarouselProject } from "../carousel/actions";
import { buildCarouselPlanPrompt, MAX_CAROUSEL_CARDS } from "@/lib/ai/carousel-prompts";
import {
  buildRepurposeFromBlogPrompt,
  assembleInstagramText,
  assembleThreadsText,
  type InstagramParts,
  type ThreadsParts,
  type WithSourceMeta,
} from "@/lib/ai/prompts";
import type { ContentSourceMeta } from "@/lib/content-source";
import { arrangeForContentType, type PhotoSelection } from "@/lib/photo-select";
import { SOURCE_PLATFORM_LABEL } from "@/lib/content-source";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { AlertTriangleIcon, CheckIcon } from "@/components/ui/Icon";
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
type TabKey = StudioPlatform | "REELS" | "CAROUSEL" | "NAVER_CLIP";

const TABS: { key: TabKey; label: string }[] = [
  { key: "BLOG", label: "블로그" },
  { key: "INSTAGRAM_FEED", label: "Instagram" },
  { key: "THREADS", label: "Threads" },
  { key: "REELS", label: "Reels" },
  { key: "CAROUSEL", label: "카드뉴스" },
  // STEP46: 네이버 클립. Reels 옆에 두어 숏폼끼리 묶는다.
  { key: "NAVER_CLIP", label: "네이버 클립" },
];

type RepurposeTarget = "INSTAGRAM_FEED" | "THREADS" | "CAROUSEL" | "REELS";

// STEP42 item 12/13: a small "X에서 생성됨" provenance label plus, when the
// source has since changed, a stale notice — never an automatic
// regeneration, only a hint that repurposing again is available. Declared
// at module scope (not inside StudioTabs) because components created during
// render reset their state on every parent re-render.
// Korean subject particle (이/가): picked from whether the label's last
// syllable has a 받침 (final consonant), via the Unicode Hangul syllable
// block's decomposition — Hangul syllables occupy U+AC00–U+D7A3 in blocks of
// 588 (19 leads × 21 vowels × 28 finals), so `(code - 0xAC00) % 28 === 0`
// means "no final consonant" (받침 없음) → 가, otherwise → 이. Caught by
// testing the actual UI text: "블로그이 변경되었습니다"/"카드뉴스이
// 변경되었습니다" are both wrong (both labels end in a 받침-less syllable),
// so a single hardcoded particle can't cover every current or future source
// label.
function withSubjectParticle(word: string): string {
  const lastChar = word.at(-1);
  if (!lastChar) return word;
  const code = lastChar.codePointAt(0)!;
  if (code < 0xac00 || code > 0xd7a3) return `${word}가`;
  const hasFinalConsonant = (code - 0xac00) % 28 !== 0;
  return `${word}${hasFinalConsonant ? "이" : "가"}`;
}

function RepurposeNotice({ sourceMeta, stale }: { sourceMeta?: ContentSourceMeta; stale: boolean }) {
  if (!sourceMeta) return null;
  const label = SOURCE_PLATFORM_LABEL[sourceMeta.sourcePlatform];
  return (
    <div className="flex flex-col gap-1">
      <Badge tone="brand">{label}에서 생성됨</Badge>
      {stale && (
        <p className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
          <AlertTriangleIcon size={13} className="mt-0.5 shrink-0" />
          원본 {withSubjectParticle(label)} 변경되었습니다. 다시 만들 수 있습니다.
        </p>
      )}
    </div>
  );
}

// STEP42 item 14: "다른 콘텐츠로 만들기" — plain-language buttons (never the
// words Repurpose/Source/Transform) placed right under the relevant studio.
function RepurposeBar({
  items,
  repurposing,
  error,
  success,
  onGoToSuccess,
}: {
  items: { target: RepurposeTarget; label: string; onClick: () => void; disabled?: boolean; reason?: string }[];
  repurposing: RepurposeTarget | null;
  error: string | null;
  success: { target: RepurposeTarget; label: string } | null;
  onGoToSuccess: (target: RepurposeTarget) => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
      <p className="text-xs font-semibold text-zinc-500">다른 콘텐츠로 만들기</p>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <Button
            key={item.target}
            variant="secondary"
            size="sm"
            className="rounded-full"
            onClick={item.onClick}
            disabled={!!item.disabled || repurposing !== null}
            loading={repurposing === item.target}
            loadingText={`${item.label} 만드는 중...`}
            title={item.reason}
          >
            {item.label}
          </Button>
        ))}
      </div>
      {error && <p className="text-[11px] text-red-600">{error}</p>}
      {success && (
        <p className="flex items-center gap-1 text-[11px] text-emerald-700">
          <CheckIcon size={12} className="shrink-0" />
          {success.label} 콘텐츠가 생성되었습니다.{" "}
          <button type="button" className="underline" onClick={() => onGoToSuccess(success.target)}>
            확인하기
          </button>
        </p>
      )}
    </div>
  );
}

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
  initialNaverClip,
  initialCarousel,
  initialPhotoSelection,
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
  // STEP46: 릴스와 같은 ReelsProject 타입이지만 완전히 별개의 prop/DB row다.
  initialNaverClip?: { id: string; generationInput: ReelsProject | null };
  initialCarousel?: { id: string; generationInput: CarouselProject | null };
  // STEP47: null when AI Photo Select has never run for this collaboration,
  // or when migration 0026 isn't applied yet (page.tsx tolerates that).
  initialPhotoSelection?: PhotoSelection | null;
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
  const photoManager = usePhotoManager(collaborationId, initialPhotos, initialPhotoSelection);
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

  // STEP42: "Source Content" repurposing. PlatformPanel/ReelsStudio/
  // CarouselStudio each seed their own internal state from `initial` only
  // once, at mount (they stay permanently mounted, just hidden, to preserve
  // in-progress edits across tab switches — see the render section below).
  // A repurpose action writes a brand-new row to `contents` from OUTSIDE
  // those components, so the only way to get the freshly generated content
  // to actually appear is to (a) keep our own mirror of each "initial"
  // value that we control, and (b) force a one-time remount (via `key`)
  // exactly when that mirror changes — router.refresh() alone can't do this
  // reliably since its timing relative to a local state update isn't
  // guaranteed, so the mirror is updated synchronously right after a
  // successful save instead of waiting on it.
  const [localInstagram, setLocalInstagram] = useState(initialInstagram);
  const [localThreads, setLocalThreads] = useState(initialThreads);
  const [localCarousel, setLocalCarousel] = useState(initialCarousel);
  const [localReels, setLocalReels] = useState(initialReels);
  // STEP46: 네이버 클립은 릴스와 별도 state. 같이 두면 한쪽 저장이 다른 쪽
  // 화면을 덮어쓴다.
  const [localNaverClip, setLocalNaverClip] = useState(initialNaverClip);
  const [remountNonce, setRemountNonce] = useState(0);
  // STEP43 fix (found via real testing): CarouselStudio/ReelsStudio/
  // PlatformPanel also save through their OWN native "저장" button, entirely
  // independent of the repurpose flow above — that save calls
  // router.refresh() itself, which re-fetches these `initialX` props from
  // the server. Without re-syncing, localCarousel/etc stayed stuck at
  // whatever they were when StudioTabs first mounted (e.g. undefined for a
  // freshly-created collaboration), so "이 카드뉴스로 릴스 만들기" never
  // appeared even after a real save+refresh. Mirrors the exact
  // prop-changed-since-last-render comparison usePhotoManager.ts already
  // uses for the same reason — not a new pattern in this codebase.
  const [syncedInstagram, setSyncedInstagram] = useState(initialInstagram);
  if (initialInstagram !== syncedInstagram) {
    setSyncedInstagram(initialInstagram);
    setLocalInstagram(initialInstagram);
  }
  const [syncedThreads, setSyncedThreads] = useState(initialThreads);
  if (initialThreads !== syncedThreads) {
    setSyncedThreads(initialThreads);
    setLocalThreads(initialThreads);
  }
  const [syncedCarousel, setSyncedCarousel] = useState(initialCarousel);
  if (initialCarousel !== syncedCarousel) {
    setSyncedCarousel(initialCarousel);
    setLocalCarousel(initialCarousel);
  }
  const [syncedReels, setSyncedReels] = useState(initialReels);
  if (initialReels !== syncedReels) {
    setSyncedReels(initialReels);
    setLocalReels(initialReels);
  }
  const [syncedNaverClip, setSyncedNaverClip] = useState(initialNaverClip);
  if (initialNaverClip !== syncedNaverClip) {
    setSyncedNaverClip(initialNaverClip);
    setLocalNaverClip(initialNaverClip);
  }

  const [repurposing, setRepurposing] = useState<RepurposeTarget | null>(null);
  const repurposingRef = useRef(false);
  const [repurposeError, setRepurposeError] = useState<string | null>(null);
  const [repurposeSuccess, setRepurposeSuccess] = useState<{ target: RepurposeTarget; label: string } | null>(null);
  const [repurposeConfirm, setRepurposeConfirm] = useState<{
    target: RepurposeTarget;
    label: string;
    run: () => Promise<void>;
  } | null>(null);
  const router = useRouter();

  const blogRef = useRef<PhotoBlogStudioHandle>(null);
  const igRef = useRef<PlatformPanelHandle>(null);
  const threadsRef = useRef<PlatformPanelHandle>(null);
  // STEP36 item 22: `pipelineRunning` state alone isn't enough — a second
  // click can fire before React re-renders with the disabled button, so a
  // synchronous ref is checked first to guarantee only one run starts.
  const pipelineRunningRef = useRef(false);
  // STEP47: "추천 사진으로 콘텐츠 만들기" jumps to the existing 결과 확인/편집
  // section — no new studio shell is introduced.
  const resultSectionRef = useRef<HTMLElement>(null);

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

  // ---------------------------------------------------------------------
  // STEP42: Source Content repurposing.
  //
  // requestRepurpose() is the single gate every repurpose action goes
  // through: if the target already has content, it stops and asks for
  // confirmation (STEP42 item 5) instead of silently overwriting a user's
  // own edits; otherwise it just runs immediately. The synchronous
  // repurposingRef guard (same pattern as pipelineRunningRef above and
  // STEP40's renderingRef) stops a double-click from firing the AI call or
  // the deterministic mapping twice.
  // ---------------------------------------------------------------------
  function requestRepurpose(target: RepurposeTarget, label: string, hasExisting: boolean, run: () => Promise<void>) {
    if (repurposingRef.current) return;
    setRepurposeError(null);
    setRepurposeSuccess(null);
    if (hasExisting) {
      setRepurposeConfirm({ target, label, run });
      return;
    }
    void run();
  }

  async function runRepurpose(target: RepurposeTarget, task: () => Promise<void>) {
    repurposingRef.current = true;
    setRepurposing(target);
    setRepurposeError(null);
    try {
      await task();
    } catch (err) {
      setRepurposeError(err instanceof Error ? err.message : "생성에 실패했습니다.");
    } finally {
      repurposingRef.current = false;
      setRepurposing(null);
    }
  }

  // Blog → Instagram / Blog → Threads (item 6/7): reuses the existing
  // CONTENT_GENERATE-costed /api/ai/generate route — repurposing from a
  // Blog isn't priced differently from a from-scratch generation, it's the
  // same "write one SNS post" operation with a richer source (STEP42 item
  // 19). Guide Check for the result is computed independently by
  // PlatformPanel itself once it re-mounts with the new content (item 18) —
  // nothing here special-cases it.
  async function repurposeBlogToPlatform(platform: "INSTAGRAM_FEED" | "THREADS") {
    if (!initialBlog?.id || !initialBlog.body.trim()) {
      setRepurposeError("먼저 블로그를 작성하고 저장해주세요.");
      return;
    }
    const label = platform === "INSTAGRAM_FEED" ? "Instagram" : "Threads";
    const existing = platform === "INSTAGRAM_FEED" ? localInstagram : localThreads;
    const run = () =>
      runRepurpose(platform, async () => {
        const { systemPrompt, prompt, responseSchema } = buildRepurposeFromBlogPrompt(platform, initialBlog!.body, {
          ...collaborationInfo,
          reviewNotes,
        });
        const res = await fetch("/api/ai/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ systemPrompt, prompt, responseSchema, collaborationId, operation: "CONTENT_GENERATE" }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "생성에 실패했습니다.");
        const parsed = parseJsonResponse<InstagramParts | ThreadsParts>(data.content);
        const sourceMeta: ContentSourceMeta = {
          sourcePlatform: "NAVER_BLOG",
          sourceContentId: initialBlog!.id,
          sourceGeneratedAt: new Date().toISOString(),
          sourceSnapshot: initialBlog!.body,
        };
        const withMeta: WithSourceMeta<PlatformParts> = { ...parsed, sourceMeta };
        const bodyText =
          platform === "INSTAGRAM_FEED"
            ? assembleInstagramText(parsed as InstagramParts)
            : assembleThreadsText(parsed as ThreadsParts);

        // STEP42 item 4: never touches the Blog row. Always inserts a new
        // contents row for the target — the same "regenerate creates a new
        // row, the newest one wins in page.tsx's `.find()`" convention
        // PlatformPanel's own regenerate already follows, so no existing
        // behavior changes.
        const result = await saveContent({ collaborationId, platform, body: bodyText, generationInput: withMeta });
        if ("error" in result) throw new Error(result.error);

        const nextLocal = { id: result.id, body: bodyText, status: "DRAFT" as const, generationInput: withMeta };
        if (platform === "INSTAGRAM_FEED") setLocalInstagram(nextLocal);
        else setLocalThreads(nextLocal);
        setStatus(platform, "DONE");
        setRemountNonce((n) => n + 1);
        setTab(platform);
        setRepurposeSuccess({ target: platform, label });
        router.refresh();
      });

    requestRepurpose(platform, label, !!existing, run);
  }

  // Blog → Carousel (item 8): reuses STEP41's carousel-plan AI call/schema/
  // credit (CAROUSEL_PLAN, 5 credits) as-is, just with the Blog's text added
  // as an extra source — no new operation, no new route. Photo selection
  // still goes through photo.ai_analysis exactly like a from-scratch AI 카드뉴스
  // 만들기 (see buildCarouselPlanPrompt) — never re-analyzed here.
  async function repurposeBlogToCarousel() {
    if (!initialBlog?.id || !initialBlog.body.trim()) {
      setRepurposeError("먼저 블로그를 작성하고 저장해주세요.");
      return;
    }
    const analyzed = photoManager.photos.filter((p) => p.ai_analysis);
    if (analyzed.length === 0) {
      setRepurposeError("먼저 사진을 추가하고 분석해주세요.");
      return;
    }
    const run = () =>
      runRepurpose("CAROUSEL", async () => {
        const { systemPrompt, prompt, responseSchema } = buildCarouselPlanPrompt({
          brandName: photoBlogInfo.brandName,
          productName: photoBlogInfo.productName,
          requiredKeywords: photoBlogInfo.requiredKeywords,
          requiredHashtags: photoBlogInfo.requiredHashtags,
          contentGuide: photoBlogInfo.contentGuide,
          guideRawContent: photoBlogInfo.guideRawContent,
          reviewNotes,
          styleSamples: photoBlogInfo.styleSamples,
          photos: analyzed.map((p) => ({ id: p.id, description: p.ai_analysis as string })),
          sourceBlogText: initialBlog!.body,
        });
        const res = await fetch("/api/ai/carousel-plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ systemPrompt, prompt, responseSchema, collaborationId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "생성에 실패했습니다.");
        const parsed = parseJsonResponse<{
          cards: { photoId: string; role: string; headline: string; body: string }[];
        }>(data.content);

        const photoById = new Map(photoManager.photos.map((p) => [p.id, p]));
        const VALID_ROLES = new Set<CarouselCardRole>([
          "cover",
          "product",
          "detail",
          "usage",
          "feature",
          "experience",
          "closing",
        ]);
        const cards: CarouselCard[] = parsed.cards
          .map((c, i): CarouselCard | null => {
            if (!photoById.has(c.photoId)) return null;
            return {
              id: `card-${i}-${c.photoId}`,
              photoId: c.photoId,
              role: VALID_ROLES.has(c.role as CarouselCardRole) ? (c.role as CarouselCardRole) : "detail",
              headline: c.headline ?? "",
              body: c.body ?? "",
              included: true,
              textPosition: "bottom",
              textAlign: "center",
              headlineSize: "medium",
            };
          })
          .filter((c): c is CarouselCard => c !== null)
          // STEP43 item 33/71: same safety-net clamp as CarouselStudio's
          // from-scratch generation — never more than MAX_CAROUSEL_CARDS,
          // never padded to a minimum.
          .slice(0, MAX_CAROUSEL_CARDS);
        if (cards.length === 0) throw new Error("AI가 유효한 카드를 만들지 못했습니다. 다시 시도해주세요.");

        const sourceMeta: ContentSourceMeta = {
          sourcePlatform: "NAVER_BLOG",
          sourceContentId: initialBlog!.id,
          sourceGeneratedAt: new Date().toISOString(),
          sourceSnapshot: initialBlog!.body,
        };
        const project: CarouselProject = {
          cards,
          template: localCarousel?.generationInput?.template ?? "clean",
          aspectRatio: localCarousel?.generationInput?.aspectRatio ?? "4:5",
          guideTextAtGeneration: photoBlogInfo.guideRawContent ?? null,
          sourceMeta,
        };
        const result = await saveCarouselProject({ collaborationId, project });
        if ("error" in result) throw new Error(result.error);

        setLocalCarousel({ id: result.id, generationInput: project });
        setRemountNonce((n) => n + 1);
        setTab("CAROUSEL");
        setRepurposeSuccess({ target: "CAROUSEL", label: "카드뉴스" });
        router.refresh();
      });

    requestRepurpose("CAROUSEL", "카드뉴스", !!localCarousel, run);
  }

  // Carousel → Reels (item 9/10): pure deterministic mapping, NO AI call —
  // see reels/from-carousel.ts. Zero credits, zero ai_usage_logs rows.
  function repurposeCarouselToReels() {
    const carouselProject = localCarousel?.generationInput;
    if (!localCarousel?.id || !carouselProject) {
      setRepurposeError("먼저 카드뉴스를 만들고 저장해주세요.");
      return;
    }
    const includedCount = carouselProject.cards.filter((c) => c.included).length;
    if (includedCount === 0) {
      setRepurposeError("포함된 카드가 없습니다.");
      return;
    }
    const run = () =>
      runRepurpose("REELS", async () => {
        const sourceMeta: ContentSourceMeta = {
          sourcePlatform: "CAROUSEL",
          sourceContentId: localCarousel.id,
          sourceGeneratedAt: new Date().toISOString(),
          sourceSnapshot: JSON.stringify(carouselProject.cards),
        };
        const project: ReelsProject = { ...buildReelsProjectFromCarousel(carouselProject), sourceMeta };
        const result = await saveReelsProject({ collaborationId, project });
        if ("error" in result) throw new Error(result.error);

        setLocalReels({ id: result.id, generationInput: project });
        setRemountNonce((n) => n + 1);
        setTab("REELS");
        setRepurposeSuccess({ target: "REELS", label: "Reels" });
        router.refresh();
      });

    requestRepurpose("REELS", "Reels", !!localReels, run);
  }

  // STEP42 item 13: source-changed / stale detection — compares the
  // repurposed content's frozen sourceSnapshot against the source's CURRENT
  // text/cards. Never auto-regenerates; only surfaces a notice so the user
  // can choose to repurpose again.
  const blogSourceChangedFor = (sourceMeta: ContentSourceMeta | undefined) =>
    !!sourceMeta &&
    sourceMeta.sourcePlatform === "NAVER_BLOG" &&
    sourceMeta.sourceContentId === initialBlog?.id &&
    sourceMeta.sourceSnapshot !== initialBlog?.body;
  const carouselSourceChangedFor = (sourceMeta: ContentSourceMeta | undefined) =>
    !!sourceMeta &&
    sourceMeta.sourcePlatform === "CAROUSEL" &&
    sourceMeta.sourceContentId === localCarousel?.id &&
    sourceMeta.sourceSnapshot !== JSON.stringify(localCarousel?.generationInput?.cards ?? []);

  const instagramSourceMeta = (localInstagram?.generationInput as WithSourceMeta<PlatformParts> | null)?.sourceMeta;
  const threadsSourceMeta = (localThreads?.generationInput as WithSourceMeta<PlatformParts> | null)?.sourceMeta;
  const carouselSourceMeta = localCarousel?.generationInput?.sourceMeta;
  const reelsSourceMeta = localReels?.generationInput?.sourceMeta;

  const photoCount = photoManager.photos.length;
  const analyzedPhotoCount = photoCount - unanalyzedPhotoCount;

  // STEP47 Step 33 — 콘텐츠별 구성. ONE common recommended set (the photos
  // that survive photoManager.excludePhotoIds, exactly as before STEP47),
  // then a LIGHT per-content-type adjustment on top. Deliberately not a
  // per-platform ranking system: arrangeForContentType only ever reorders,
  // it never adds a photo the user excluded and never pads.
  //   - Blog      : PhotoBlogStudio keeps reading photoManager directly, so
  //                 paragraphs stay bound to display_order (사진-문단 대응).
  //   - Carousel  : 대표 이미지 후보 first; the existing MAX_CAROUSEL_CARDS
  //                 cap still lives in CarouselStudio, untouched.
  //   - Reels/Clip: recommended set in display_order (cover already moved to
  //                 first by the select run); video scenes are unaffected.
  const usablePhotos = photoManager.photos.filter((p) => !photoManager.excludePhotoIds.has(p.id));
  const carouselPhotos = arrangeForContentType(usablePhotos, photoManager.selection, "CAROUSEL");
  const shortFormPhotos = arrangeForContentType(usablePhotos, photoManager.selection, "SHORTFORM");

  return (
    <div className="flex flex-col gap-6">
      {/* STEP43-1: workspace header — real brand/product + real guide/photo
          readiness (no fabricated states), so Content Studio reads as one
          workspace instead of a bare tab page. */}
      <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div>
          <p className="text-xs font-medium text-zinc-400">콘텐츠 제작실</p>
          <p className="mt-0.5 text-base font-semibold text-zinc-900">
            {photoBlogInfo.brandName} · {photoBlogInfo.productName}
          </p>
          {photoBlogInfo.campaignName && <p className="text-xs text-zinc-500">{photoBlogInfo.campaignName}</p>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={guideAnalysis ? (guideStale ? "warning" : "success") : "neutral"}>
            {guideAnalysis ? (guideStale ? "가이드 △ 재분석 필요" : "가이드 ✓ 분석 완료") : "가이드 미분석"}
          </Badge>
          <Badge tone={photoCount === 0 ? "neutral" : analyzedPhotoCount === photoCount ? "success" : "warning"}>
            {photoCount === 0 ? "사진 없음" : `사진 ${photoCount}장 · 분석 ${analyzedPhotoCount}/${photoCount}`}
          </Badge>
        </div>
      </div>

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
        collaborationId={collaborationId}
        brandName={photoBlogInfo.brandName}
        productName={photoBlogInfo.productName}
        guideRawContent={guideText}
        guideAnalysis={guideAnalysis}
        reviewNotes={reviewNotes}
        onGoToStudio={() => {
          setTab("BLOG");
          resultSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
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
            <Button
              onClick={handleStartClick}
              disabled={pipelineRunning || checkingBudget || selectedCount === 0}
              loading={pipelineRunning || checkingBudget}
              loadingText={pipelineRunning ? "콘텐츠 만드는 중..." : "크레딧 확인 중..."}
              size="lg"
              className="mt-2 flex-1"
            >
              {budgetWarning ? "그래도 진행" : "AI 콘텐츠 만들기"}
            </Button>
            {budgetWarning && (
              <Button variant="secondary" size="lg" className="mt-2" onClick={() => setBudgetWarning(null)}>
                취소
              </Button>
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
      <section ref={resultSectionRef}>
        <SectionHeader
          step={7}
          title="결과 확인/편집"
          description="플랫폼별 결과를 확인하고 필요한 부분만 고쳐보세요. 각 결과 하단에서 가이드 충족 여부(✓/△/✕)를 바로 확인할 수 있습니다."
        />
        <div className="mt-3 flex gap-1 overflow-x-auto border-b border-zinc-200">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`shrink-0 rounded-t-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                tab === t.key
                  ? "border-b-2 border-brand-600 text-brand-700"
                  : "border-b-2 border-transparent text-zinc-500 hover:text-zinc-900"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* All tab panels stay mounted (just hidden) so switching tabs never
            loses in-progress edits, and the one-click refs above stay valid
            regardless of which tab is currently visible. */}
        <div className={`mt-4 flex flex-col gap-3 ${tab === "BLOG" ? "" : "hidden"}`}>
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
          {initialBlog?.id && (
            <RepurposeBar
              items={[
                {
                  target: "INSTAGRAM_FEED",
                  label: "이 글로 인스타 만들기",
                  onClick: () => repurposeBlogToPlatform("INSTAGRAM_FEED"),
                },
                {
                  target: "THREADS",
                  label: "이 글로 Threads 만들기",
                  onClick: () => repurposeBlogToPlatform("THREADS"),
                },
                {
                  target: "CAROUSEL",
                  label: "이 글로 카드뉴스 만들기",
                  onClick: () => repurposeBlogToCarousel(),
                },
              ]}
              repurposing={repurposing}
              error={repurposeError}
              success={repurposeSuccess}
              onGoToSuccess={setTab}
            />
          )}
        </div>
        <div className={`mt-4 flex flex-col gap-3 ${tab === "INSTAGRAM_FEED" ? "" : "hidden"}`}>
          <PlatformPanel
            key={`ig-${remountNonce}`}
            ref={igRef}
            platform="INSTAGRAM_FEED"
            collaborationId={collaborationId}
            collaborationInfo={collaborationInfo}
            reviewNotes={reviewNotes}
            initial={localInstagram}
            guideAnalysis={guideAnalysis}
            onStatusChange={(s) => setStatus("INSTAGRAM_FEED", s)}
          />
          <RepurposeNotice sourceMeta={instagramSourceMeta} stale={blogSourceChangedFor(instagramSourceMeta)} />
        </div>
        <div className={`mt-4 flex flex-col gap-3 ${tab === "THREADS" ? "" : "hidden"}`}>
          <PlatformPanel
            key={`th-${remountNonce}`}
            ref={threadsRef}
            platform="THREADS"
            collaborationId={collaborationId}
            collaborationInfo={collaborationInfo}
            reviewNotes={reviewNotes}
            initial={localThreads}
            guideAnalysis={guideAnalysis}
            onStatusChange={(s) => setStatus("THREADS", s)}
          />
          <RepurposeNotice sourceMeta={threadsSourceMeta} stale={blogSourceChangedFor(threadsSourceMeta)} />
        </div>
        <div className={`mt-4 flex flex-col gap-3 ${tab === "REELS" ? "" : "hidden"}`}>
          <ReelsStudio
            key={`reels-${remountNonce}`}
            collaborationId={collaborationId}
            photos={shortFormPhotos}
            initialVideos={initialVideos}
            reviewNotes={reviewNotes}
            collaborationInfo={photoBlogInfo}
            initial={localReels}
          />
          <RepurposeNotice sourceMeta={reelsSourceMeta} stale={carouselSourceChangedFor(reelsSourceMeta)} />
        </div>
        {/* STEP46: 네이버 클립. 같은 ReelsStudio를 platform="NAVER_CLIP"으로
            재사용하므로 장면 편집 UI와 MP4 렌더러가 릴스와 100% 동일하다.
            initial 은 localNaverClip(별도 DB row)이라 릴스 프로젝트와 섞이지
            않는다. */}
        <div className={`mt-4 flex flex-col gap-3 ${tab === "NAVER_CLIP" ? "" : "hidden"}`}>
          <ReelsStudio
            key={`naver-clip-${remountNonce}`}
            platform="NAVER_CLIP"
            collaborationId={collaborationId}
            photos={shortFormPhotos}
            initialVideos={initialVideos}
            reviewNotes={reviewNotes}
            collaborationInfo={photoBlogInfo}
            initial={localNaverClip}
          />
        </div>
        <div className={`mt-4 flex flex-col gap-3 ${tab === "CAROUSEL" ? "" : "hidden"}`}>
          <CarouselStudio
            key={`carousel-${remountNonce}`}
            collaborationId={collaborationId}
            photos={carouselPhotos}
            reviewNotes={reviewNotes}
            collaborationInfo={photoBlogInfo}
            guideAnalysis={guideAnalysis}
            initial={localCarousel}
          />
          <RepurposeNotice sourceMeta={carouselSourceMeta} stale={blogSourceChangedFor(carouselSourceMeta)} />
          {localCarousel?.id && (
            <RepurposeBar
              items={[{ target: "REELS", label: "이 카드뉴스로 릴스 만들기", onClick: repurposeCarouselToReels }]}
              repurposing={repurposing}
              error={repurposeError}
              success={repurposeSuccess}
              onGoToSuccess={setTab}
            />
          )}
        </div>
      </section>

      <Modal
        open={!!repurposeConfirm}
        onClose={() => setRepurposeConfirm(null)}
        title={`이미 ${repurposeConfirm?.label ?? ""} 콘텐츠가 있습니다`}
        description="기존 내용을 유지할까요, 방금 선택한 원본을 기준으로 새로 만들까요? 새로 만들어도 지금까지 작업한 내용은 사라지지 않고 새 결과로 교체됩니다."
      >
        <Button variant="ghost" onClick={() => setRepurposeConfirm(null)}>
          취소
        </Button>
        <Button variant="secondary" onClick={() => setRepurposeConfirm(null)}>
          기존 콘텐츠 유지
        </Button>
        {/* item 46: the overwrite action is deliberately NOT styled as the
            solid brand/primary button — a destructive/replace action should
            never be the one the user reaches for out of habit. */}
        <Button
          variant="secondary"
          className="border-amber-300 text-amber-800 hover:bg-amber-50"
          onClick={() => {
            const confirm = repurposeConfirm;
            setRepurposeConfirm(null);
            if (confirm) void confirm.run();
          }}
        >
          새로 생성
        </Button>
      </Modal>
    </div>
  );
}

// Re-exported so page.tsx doesn't need to import PhotoType separately just
// for the props type above.
export type { PhotoType };
