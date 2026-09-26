"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { saveSelection, type ProductShortsMediaWithUrl } from "../actions";
import type { ProductShortsGenerationState, PhotoRecommendationRun } from "@/lib/product-shorts/recommendation-types";
import type { ReelsProject } from "@/app/(app)/collaborations/[id]/reels/actions";

type Props = {
  projectId: string;
  targetDurationSeconds: 15 | 30;
  initialMedia: ProductShortsMediaWithUrl[];
  initialState: ProductShortsGenerationState;
};

// §20: staged UI — ③AI 사진분석 ④AI 추천 ⑤최종 사진 선택 ⑥숏츠 구성 생성.
// Credit cost is shown on every button before the user commits to spending it.
export function ShortsWorkflow({ projectId, targetDurationSeconds, initialMedia, initialState }: Props) {
  const [media, setMedia] = useState(initialMedia);
  const [recommendation, setRecommendation] = useState<PhotoRecommendationRun | null>(initialState.recommendation);
  const [includedIds, setIncludedIds] = useState<string[]>(
    initialState.selection.includedIds.length > 0 ? initialState.selection.includedIds : [],
  );
  const [coverMediaId, setCoverMediaId] = useState<string | null>(initialState.selection.coverMediaId);
  const [plan, setPlan] = useState<ReelsProject | null>(initialState.plan);

  const [analyzing, setAnalyzing] = useState(false);
  const [recommending, setRecommending] = useState(false);
  const [savingSelection, setSavingSelection] = useState(false);
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unanalyzedCount = media.filter((m) => !m.aiAnalyzed).length;

  async function handleAnalyzeAll() {
    setAnalyzing(true);
    setError(null);
    try {
      for (const m of media) {
        if (m.aiAnalyzed) continue;
        const res = await fetch("/api/product-shorts/analyze-photo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, mediaId: m.id }),
        });
        const json = await res.json();
        if (!res.ok) {
          setError(json.error ?? "사진 분석에 실패했어요.");
          return;
        }
        setMedia((prev) => prev.map((x) => (x.id === m.id ? { ...x, aiAnalyzed: true } : x)));
      }
    } catch {
      setError("사진 분석에 실패했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleRecommend() {
    setRecommending(true);
    setError(null);
    try {
      const res = await fetch("/api/product-shorts/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
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
      const result = await saveSelection(projectId, {
        pinnedIds: [],
        excludedIds: media.filter((m) => !includedIds.includes(m.id)).map((m) => m.id),
        includedIds,
        coverMediaId,
      });
      if ("error" in result) setError(result.error ?? "저장에 실패했어요.");
    } finally {
      setSavingSelection(false);
    }
  }

  async function handleGeneratePlan() {
    setGeneratingPlan(true);
    setError(null);
    try {
      const res = await fetch("/api/product-shorts/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
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
      setGeneratingPlan(false);
    }
  }

  const mediaById = new Map(media.map((m) => [m.id, m]));

  return (
    <div className="mt-6 flex flex-col gap-6">
      {error && <p className="text-sm text-red-600">{error}</p>}

      <Card>
        <h2 className="text-sm font-semibold text-zinc-900">③ AI 사진 분석</h2>
        <p className="mt-1 text-xs text-zinc-500">
          {unanalyzedCount > 0
            ? `분석이 필요한 사진 ${unanalyzedCount}장 (새 사진 1장당 1 크레딧). 이미 분석한 사진은 다시 분석하지 않아요.`
            : "모든 사진이 분석되었어요."}
        </p>
        <Button variant="secondary" className="mt-3" loading={analyzing} loadingText="분석 중..." onClick={handleAnalyzeAll} disabled={unanalyzedCount === 0}>
          사진 AI 분석 시작
        </Button>
      </Card>

      <Card>
        <h2 className="text-sm font-semibold text-zinc-900">④ AI 사진 추천</h2>
        <p className="mt-1 text-xs text-zinc-500">판매 숏츠에 어울리는 사진을 AI가 골라드려요 (2 크레딧).</p>
        <Button
          variant="secondary"
          className="mt-3"
          loading={recommending}
          loadingText="추천 중..."
          onClick={handleRecommend}
          disabled={unanalyzedCount > 0}
        >
          AI 사진 추천 받기
        </Button>
        {recommendation && recommendation.missingShots.length > 0 && (
          <p className="mt-2 text-xs text-amber-600">있으면 더 좋을 컷: {recommendation.missingShots.join(", ")}</p>
        )}
      </Card>

      <Card>
        <h2 className="text-sm font-semibold text-zinc-900">⑤ 최종 사진 선택</h2>
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
        <h2 className="text-sm font-semibold text-zinc-900">⑥ {targetDurationSeconds}초 판매 숏츠 구성 생성</h2>
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
    </div>
  );
}
