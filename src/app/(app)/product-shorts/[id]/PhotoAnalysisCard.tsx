"use client";

import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { ProductShortsMediaWithUrl } from "../actions";

type Props = {
  projectId: string;
  media: ProductShortsMediaWithUrl[];
  setMedia: Dispatch<SetStateAction<ProductShortsMediaWithUrl[]>>;
};

// Project-level PHOTO_ANALYSIS (1 credit per NEW photo). The result is stored on
// product_shorts_media.ai_analysis and reused by every version (A/B/C) — a version
// never re-analyzes photos. An already-analyzed photo is skipped, so clicking again
// costs nothing.
export function PhotoAnalysisCard({ projectId, media, setMedia }: Props) {
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runningRef = useRef(false); // guards a double click between renders

  const unanalyzedCount = media.filter((m) => !m.aiAnalyzed).length;

  async function handleAnalyzeAll() {
    if (runningRef.current) return;
    runningRef.current = true;
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
      runningRef.current = false;
      setAnalyzing(false);
    }
  }

  return (
    <Card>
      <h2 className="text-sm font-semibold text-zinc-900">③ AI 사진 분석</h2>
      <p className="mt-1 text-xs text-zinc-500">
        {media.length === 0
          ? "먼저 상품 사진을 올려주세요."
          : unanalyzedCount > 0
            ? `분석이 필요한 사진 ${unanalyzedCount}장 (새 사진 1장당 1 크레딧). 이미 분석한 사진은 다시 분석하지 않고, 버전(A/B/C)마다 다시 분석하지도 않아요.`
            : "모든 사진이 분석되었어요."}
      </p>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <Button
        variant="secondary"
        className="mt-3"
        loading={analyzing}
        loadingText="분석 중..."
        onClick={handleAnalyzeAll}
        disabled={unanalyzedCount === 0}
      >
        사진 AI 분석 시작
      </Button>
    </Card>
  );
}
