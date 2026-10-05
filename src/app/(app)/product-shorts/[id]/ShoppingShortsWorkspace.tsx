"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { createProductVersion, deleteProductVersion, type ProductShortsMediaWithUrl } from "../actions";
import { PhotoAnalysisCard } from "./PhotoAnalysisCard";
import { ShortsWorkflow } from "./ShortsWorkflow";
import {
  HOOK_STYLE_LABELS,
  MAX_VERSIONS,
  SALES_ANGLE_LABELS,
  type AngleSuggestionSet,
  type SalesAngle,
} from "@/lib/product-shorts/angle-types";
import type { ProductShortsVersion } from "@/lib/product-shorts/versions";
import type { ProductShortsGenerationState } from "@/lib/product-shorts/recommendation-types";

type Props = {
  projectId: string;
  targetDurationSeconds: 15 | 30;
  initialMedia: ProductShortsMediaWithUrl[];
  initialSuggestions: AngleSuggestionSet | null;
  initialVersions: ProductShortsVersion[];
  legacyState: ProductShortsGenerationState;
};

const EMPTY_STATE: ProductShortsGenerationState = {
  version: 1,
  recommendation: null,
  selection: { pinnedIds: [], excludedIds: [], includedIds: [], coverMediaId: null },
  plan: null,
};

// ③ 사진 분석 (once per project) -> ④ 판매각도 -> ⑤ 후킹 -> ⑥ 버전 A/B/C ->
// 각 버전: 사진 추천 -> 선택 -> 구성 -> 편집(Studio) -> MP4.
// Every version is stored (and every AI call scoped) by its own versionId.
export function ShoppingShortsWorkspace({
  projectId,
  targetDurationSeconds,
  initialMedia,
  initialSuggestions,
  initialVersions,
  legacyState,
}: Props) {
  const [media, setMedia] = useState(initialMedia);
  const [suggestions, setSuggestions] = useState<AngleSuggestionSet | null>(initialSuggestions);
  const [versions, setVersions] = useState<ProductShortsVersion[]>(initialVersions);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(initialVersions[0]?.id ?? null);
  const [angleId, setAngleId] = useState<string | null>(null);
  const [hookId, setHookId] = useState<string | null>(null);
  const [loadingAngles, setLoadingAngles] = useState(false);
  const [loadingHooks, setLoadingHooks] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const aiBusyRef = useRef(false);
  const creatingRef = useRef(false);

  const analyzedCount = media.filter((m) => m.aiAnalyzed).length;
  const selectedAngle: SalesAngle | undefined = suggestions?.angles.find((a) => a.id === angleId);
  const hasLegacy = !!(legacyState.plan || legacyState.recommendation);

  async function callAngles(body: Record<string, unknown>, setLoading: (v: boolean) => void) {
    if (aiBusyRef.current) return;
    aiBusyRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/product-shorts/angles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, ...body }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "AI 결과를 만들지 못했어요.");
        return;
      }
      setSuggestions(json.suggestions as AngleSuggestionSet);
      if (body.mode !== "hooks") {
        setAngleId(null);
        setHookId(null);
      } else {
        setHookId(null); // the old hooks of this angle were replaced
      }
    } catch {
      setError("AI 결과를 만들지 못했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      aiBusyRef.current = false;
      setLoading(false);
    }
  }

  async function handleCreateVersion() {
    if (!selectedAngle || !hookId || creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    setError(null);
    try {
      const result = await createProductVersion(projectId, selectedAngle.id, hookId);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      const hook = selectedAngle.hooks.find((h) => h.id === hookId);
      const created: ProductShortsVersion = {
        id: result.id,
        label: result.label,
        angle: { type: selectedAngle.type, title: selectedAngle.title, rationale: selectedAngle.rationale },
        hook: hook?.text ?? "",
        state: EMPTY_STATE,
      };
      setVersions((prev) => [...prev, created].sort((a, b) => a.label.localeCompare(b.label)));
      setActiveVersionId(created.id);
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  }

  async function handleDeleteVersion(versionId: string) {
    setError(null);
    const result = await deleteProductVersion(projectId, versionId);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    const remaining = versions.filter((v) => v.id !== versionId);
    setVersions(remaining);
    setActiveVersionId(remaining[0]?.id ?? null);
  }

  const activeVersion = versions.find((v) => v.id === activeVersionId) ?? null;

  return (
    <div className="mt-6 flex flex-col gap-6">
      {error && <p className="text-sm text-red-600">{error}</p>}

      <PhotoAnalysisCard projectId={projectId} media={media} setMedia={setMedia} />

      <Card>
        <h2 className="text-sm font-semibold text-zinc-900">④ 판매각도 · ⑤ 후킹</h2>
        <p className="mt-1 text-xs text-zinc-500">
          상품 정보와 사진 분석 결과로 판매각도와 각도별 후킹 10개를 만들어요 (3 크레딧). 사진은 다시 분석하지 않아요.
        </p>
        <Button
          variant="secondary"
          className="mt-3"
          loading={loadingAngles}
          loadingText="만드는 중..."
          onClick={() => callAngles({ mode: "angles" }, setLoadingAngles)}
          disabled={analyzedCount === 0 || loadingHooks}
        >
          {suggestions ? "판매각도 다시 만들기 (3 크레딧)" : "판매각도·후킹 만들기 (3 크레딧)"}
        </Button>
        {analyzedCount === 0 && <p className="mt-2 text-xs text-zinc-400">먼저 ③ 사진 AI 분석을 완료해주세요.</p>}

        {suggestions && (
          <div className="mt-4 flex flex-col gap-3">
            <p className="text-xs font-medium text-zinc-700">판매각도를 하나 골라주세요</p>
            <ul className="flex flex-col gap-2">
              {suggestions.angles.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setAngleId(a.id);
                      setHookId(null);
                    }}
                    className={`w-full rounded-lg border p-3 text-left text-sm ${angleId === a.id ? "border-indigo-500 bg-indigo-50" : "border-zinc-200 hover:bg-zinc-50"}`}
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-zinc-900">{a.title}</span>
                      <Badge tone="neutral">{SALES_ANGLE_LABELS[a.type]}</Badge>
                      {a.recommended && <Badge tone="brand">추천</Badge>}
                    </span>
                    <span className="mt-1 block text-xs text-zinc-500">{a.rationale}</span>
                  </button>
                </li>
              ))}
            </ul>

            {selectedAngle && (
              <div className="mt-2">
                <p className="text-xs font-medium text-zinc-700">후킹을 하나 골라주세요 ({selectedAngle.hooks.length}개)</p>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {selectedAngle.hooks.map((h) => (
                    <li key={h.id}>
                      <button
                        type="button"
                        onClick={() => setHookId(h.id)}
                        className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm ${hookId === h.id ? "border-indigo-500 bg-indigo-50" : "border-zinc-200 hover:bg-zinc-50"}`}
                      >
                        <span className="text-zinc-900">{h.text}</span>
                        <span className="flex shrink-0 items-center gap-1">
                          <Badge tone="neutral">{HOOK_STYLE_LABELS[h.style]}</Badge>
                          {h.recommended && <Badge tone="brand">추천</Badge>}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <Button
                  variant="secondary"
                  className="mt-3"
                  loading={loadingHooks}
                  loadingText="다시 만드는 중..."
                  onClick={() => callAngles({ mode: "hooks", angleId: selectedAngle.id }, setLoadingHooks)}
                  disabled={loadingAngles}
                >
                  이 각도의 후킹 다시 만들기 (3 크레딧)
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>

      <Card>
        <h2 className="text-sm font-semibold text-zinc-900">⑥ 숏츠 버전 (A / B / C)</h2>
        <p className="mt-1 text-xs text-zinc-500">
          고른 판매각도와 후킹으로 버전을 만들어요 (크레딧 없음). 버전은 서로 독립적으로 저장되어, 한 버전을 고치거나 다시 만들어도 다른 버전은 바뀌지 않아요. 최대 {MAX_VERSIONS}개.
        </p>
        <Button
          variant="secondary"
          className="mt-3"
          loading={creating}
          loadingText="만드는 중..."
          onClick={handleCreateVersion}
          disabled={!selectedAngle || !hookId || versions.length >= MAX_VERSIONS}
        >
          선택한 각도·후킹으로 버전 만들기
        </Button>
        {versions.length >= MAX_VERSIONS && <p className="mt-2 text-xs text-zinc-400">버전은 최대 {MAX_VERSIONS}개까지예요.</p>}

        {versions.length > 0 && (
          <div className="mt-4">
            <div role="tablist" className="flex gap-2">
              {versions.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  role="tab"
                  aria-selected={v.id === activeVersionId}
                  onClick={() => setActiveVersionId(v.id)}
                  className={`rounded-lg border px-4 py-1.5 text-sm font-medium ${v.id === activeVersionId ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"}`}
                >
                  버전 {v.label}
                </button>
              ))}
            </div>
            {activeVersion && (
              <div className="mt-3 rounded-lg border border-zinc-200 p-3 text-sm">
                <p className="text-zinc-900">
                  <span className="font-medium">{activeVersion.angle.title}</span>{" "}
                  <span className="text-xs text-zinc-500">({SALES_ANGLE_LABELS[activeVersion.angle.type]})</span>
                </p>
                <p className="mt-1 text-zinc-700">후킹: {activeVersion.hook}</p>
                <button type="button" onClick={() => handleDeleteVersion(activeVersion.id)} className="mt-2 text-xs text-red-600 underline">
                  이 버전 삭제
                </button>
              </div>
            )}
          </div>
        )}
      </Card>

      {activeVersion && (
        <ShortsWorkflow
          key={activeVersion.id}
          projectId={projectId}
          versionId={activeVersion.id}
          targetDurationSeconds={targetDurationSeconds}
          media={media}
          setMedia={setMedia}
          initialState={activeVersion.state}
          studioHref={`/product-shorts/${projectId}/studio?version=${activeVersion.id}`}
        />
      )}

      {hasLegacy && (
        <div>
          <h2 className="text-sm font-semibold text-zinc-900">이전 방식으로 만든 숏츠</h2>
          <p className="mt-1 text-xs text-zinc-500">판매각도 기능이 생기기 전에 만든 숏츠예요. 그대로 편집할 수 있어요.</p>
          <ShortsWorkflow
            projectId={projectId}
            targetDurationSeconds={targetDurationSeconds}
            media={media}
            setMedia={setMedia}
            initialState={legacyState}
            studioHref={`/product-shorts/${projectId}/studio`}
          />
        </div>
      )}
    </div>
  );
}
