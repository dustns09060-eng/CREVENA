"use client";

import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { saveSelection, type ProductShortsMediaWithUrl } from "../actions";
import { PhotoAnalysisCard } from "./PhotoAnalysisCard";
import type { ProductShortsGenerationState, PhotoRecommendationRun } from "@/lib/product-shorts/recommendation-types";
import type { ReelsProject } from "@/app/(app)/collaborations/[id]/reels/actions";

type Props = {
  projectId: string;
  // Set for an A/B/C version: every call below is then scoped to that one version's
  // row, so it can never touch another version. Unset = the project's single V1 state.
  versionId?: string | null;
  targetDurationSeconds: 15 | 30;
  // Project-level photos, shared by every version (controlled by the parent).
  media: ProductShortsMediaWithUrl[];
  setMedia: Dispatch<SetStateAction<ProductShortsMediaWithUrl[]>>;
  initialState: ProductShortsGenerationState;
  studioHref: string;
  // Legacy V1 projects (no versions) keep the photo-analysis card inside this workflow.
  showAnalysis?: boolean;
};

// Staged UI for ONE short: 사진 추천 -> 최종 사진 선택 -> 구성 생성 -> 편집/MP4.
// Credit cost is shown on every button before the user commits to spending it.
export function ShortsWorkflow({
  projectId,
  versionId = null,
  targetDurationSeconds,
  media,
  setMedia,
  initialState,
  studioHref,
  showAnalysis = false,
}: Props) {
  const [recommendation, setRecommendation] = useState<PhotoRecommendationRun | null>(initialState.recommendation);
  const [includedIds, setIncludedIds] = useState<string[]>(
    initialState.selection.includedIds.length > 0 ? initialState.selection.includedIds : [],
  );
  const [coverMediaId, setCoverMediaId] = useState<string | null>(initialState.selection.coverMediaId);
  const [plan, setPlan] = useState<ReelsProject | null>(initialState.plan);

  const [recommending, setRecommending] = useState(false);
  const [savingSelection, setSavingSelection] = useState(false);
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recommendingRef = useRef(false);
  const planningRef = useRef(false);

  const unanalyzedCount = media.filter((m) => !m.aiAnalyzed).length;

  async function handleRecommend() {
    if (recommendingRef.current) return;
    recommendingRef.current = true;
    setRecommending(true);
    setError(null);
    try {
      const res = await fetch("/api/product-shorts/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, versionId }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "AI 추천에 실패했어요.");
        return;
      }
      const run: PhotoRecommendationRun = json.recommendation;
      setRecommendation(run);
      setIncludedIds(run.selectedMediaIds);
      setCoverMediaId(run.coverCandidateIds.length > 0 ? run.coverCandidateIds[0] : null);
    } catch {
      setError("AI 추천에 실패했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      recommendingRef.current = false;
      setRecommending(false);
    }
  }

  function toggleInclude(mediaId: string) {
    setIncludedIds((prev) => (prev.includes(mediaId) ? prev.filter((id) => id !== mediaId) : [...prev, mediaId]));
  }

  async function handleSaveSelection() {
    setSavingSelection(true);
    setError(null);
    try {
      const result = await saveSelection(
        projectId,
        {
          pinnedIds: [],
          excludedIds: media.filter((m) => !includedIds.includes(m.id)).map((m) => m.id),
          includedIds,
          coverMediaId,
        },
        versionId,
      );
      if ("error" in result) setError(result.error ?? "저장에 실패했어요.");
    } finally {
      setSavingSelection(false);
    }
  }

  async function handleGeneratePlan() {
    if (planningRef.current) return;
    planningRef.current = true;
    setGeneratingPlan(true);
    setError(null);
    try {
      const res = await fetch("/api/product-shorts/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, versionId }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "숏츠 구성 생성에 실패했어요.");
        return;
      }
      setPlan(json.plan);
    } catch {
      setError("숏츠 구성 생성에 실패했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      planningRef.current = false;
      setGeneratingPlan(false);
    }
  }

  const mediaById = new Map(media.map((m) => [m.id, m]));

  return (
    <div className="mt-6 flex flex-col gap-6">
      {error && <p className="text-sm text-red-600">{error}</p>}

      {showAnalysis && <PhotoAnalysisCard projectId={projectId} media={media} setMedia={setMedia} />}

      <Card>
        <h2 className="text-sm font-semibold text-zinc-900">사진 추천 (AI)</h2>
        <p className="mt-1 text-xs text-zinc-500">
          {versionId
            ? "이 버전의 판매각도에 어울리는 사진을 AI가 골라드려요 (2 크레딧). 사진 분석은 다시 하지 않아요."
            : "판매 숏츠에 어울리는 사진을 AI가 골라드려요 (2 크레딧)."}
        </p>
        <Button
          variant="secondary"
          className="mt-3"
          loading={recommending}
          loadingText="추천 중..."
          onClick={handleRecommend}
          disabled={unanalyzedCount > 0 || media.length === 0}
        >
          AI 사진 추천 받기
        </Button>
        {unanalyzedCount > 0 && <p className="mt-2 text-xs text-zinc-400">먼저 ③ 사진 AI 분석을 완료해주세요.</p>}
        {recommendation && recommendation.missingShots.length > 0 && (
          <p className="mt-2 text-xs text-amber-600">있으면 더 좋을 컷: {recommendation.missingShots.join(", ")}</p>
        )}
      </Card>

      <Card>
        <h2 className="text-sm font-semibold text-zinc-900">최종 사진 선택</h2>
        <p className="mt-1 text-xs text-zinc-500">AI 추천은 참고용이에요. 자유롭게 사용/제외를 바꾸고 대표 사진을 골라주세요.</p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {media.map((m) => {
            const included = includedIds.includes(m.id);
            const roleInfo = recommendation?.reasons.find((r) => r.mediaId === m.id);
            return (
              <div
                key={m.id}
                className={`relative aspect-square overflow-hidden rounded-lg border ${included ? "border-indigo-500" : "border-zinc-200 opacity-50"}`}
              >
                {m.thumbUrl && (
                  // eslint-disable-next-line @next/next/no-img-element -- signed URL
                  <img src={m.thumbUrl} alt="" className="h-full w-full object-cover" onClick={() => toggleInclude(m.id)} />
                )}
                {roleInfo && <span className="absolute top-1 left-1 rounded bg-black/60 px-1 text-[10px] text-white">{roleInfo.role}</span>}
                <button
                  type="button"
                  onClick={() => setCoverMediaId(m.id)}
                  className={`absolute bottom-1 left-1 rounded px-1 text-[10px] ${coverMediaId === m.id ? "bg-indigo-600 text-white" : "bg-black/60 text-white"}`}
                >
                  대표
                </button>
                <button type="button" onClick={() => toggleInclude(m.id)} className="absolute top-1 right-1 rounded bg-black/60 px-1 text-[10px] text-white">
                  {included ? "사용" : "제외"}
                </button>
              </div>
            );
          })}
        </div>
        <Button variant="secondary" className="mt-3" loading={savingSelection} loadingText="저장 중..." onClick={handleSaveSelection}>
          선택 저장
        </Button>
      </Card>

      <Card>
        <h2 className="text-sm font-semibold text-zinc-900">{targetDurationSeconds}초 판매 숏츠 구성 생성</h2>
        <p className="mt-1 text-xs text-zinc-500">선택한 사진으로 장면 구성을 만들어요 (5 크레딧).</p>
        <Button
          variant="secondary"
          className="mt-3"
          loading={generatingPlan}
          loadingText="구성 생성 중..."
          onClick={handleGeneratePlan}
          disabled={includedIds.length === 0}
        >
          {targetDurationSeconds}초 숏츠 만들기
        </Button>
        {plan && (
          <ol className="mt-4 flex flex-col gap-2 text-sm">
            {plan.scenes.map((scene) => (
              <li key={scene.id} className="flex gap-3 rounded border border-zinc-200 p-2">
                <div className="h-16 w-16 shrink-0 overflow-hidden rounded bg-zinc-100">
                  {mediaById.get(scene.mediaId)?.thumbUrl && (
                    // eslint-disable-next-line @next/next/no-img-element -- signed URL
                    <img src={mediaById.get(scene.mediaId)!.thumbUrl!} alt="" className="h-full w-full object-cover" />
                  )}
                </div>
                <div>
                  <p className="text-xs text-zinc-500">{scene.durationSeconds}초</p>
                  <p className="text-zinc-900">{scene.caption}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card>
        <h2 className="text-sm font-semibold text-zinc-900">숏츠 편집 및 MP4</h2>
        <p className="mt-1 text-xs text-zinc-500">
          {plan
            ? "장면 순서·길이·자막을 다듬고 9:16 미리보기를 본 뒤 MP4로 만들 수 있어요. 추가 크레딧은 들지 않아요."
            : "숏츠 구성을 먼저 만들면 편집할 수 있어요."}
        </p>
        {plan ? (
          <Link
            href={studioHref}
            className="mt-3 inline-block rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-100"
          >
            편집하기
          </Link>
        ) : (
          <span className="mt-3 inline-block cursor-not-allowed rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-400">
            편집하기
          </span>
        )}
      </Card>
    </div>
  );
}
