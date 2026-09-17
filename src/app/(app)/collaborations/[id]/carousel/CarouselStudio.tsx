"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  saveCarouselProject,
  type CarouselProject,
  type CarouselCard,
  type CarouselTemplate,
  type CarouselAspectRatio,
} from "./actions";
import { buildCarouselPlanPrompt, parseJsonResponse, type CarouselPhotoSummary } from "@/lib/ai/carousel-prompts";
import { renderCarouselCardToCanvas, renderCarouselCardToPngBlob, ASPECT_SIZES } from "./render";
import { createZipBlob } from "@/lib/simple-zip";
import { OPERATION_CREDIT_COST } from "@/lib/ai/credits";
import type { ReviewNotes, StyleSample } from "@/lib/ai/prompts";
import { checkAgainstGuideAnalysis, checkContentDeterministic } from "@/lib/content-guide-check";
import { GuideCheckList, buildDeterministicGuideItems } from "../content/studio-ui";
import type { GuideAnalysis } from "@/lib/ai/guide-analysis-prompts";
import type { CollaborationPhoto } from "@/types/database";

type PhotoWithUrl = CollaborationPhoto & { fullUrl: string; thumbUrl: string };

type CollaborationInfo = {
  brandName: string;
  productName: string;
  requiredKeywords: string | null;
  requiredHashtags: string | null;
  requiredMentions?: string | null;
  adDisclosureText?: string | null;
  contentGuide: string | null;
  guideRawContent: string | null;
  styleSamples: StyleSample[];
};

async function callGenerate(args: {
  prompt: string;
  systemPrompt: string;
  collaborationId: string;
  endpoint: string;
  responseSchema?: unknown;
}) {
  const res = await fetch(args.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "요청에 실패했습니다.");
  return data.content as string;
}

const TEMPLATE_OPTIONS: { key: CarouselTemplate; label: string; description: string }[] = [
  { key: "minimal", label: "Minimal", description: "사진 위에 어두운 그라디언트, 흰 텍스트" },
  { key: "clean", label: "Clean", description: "하단 흰색 카드 패널, 진한 텍스트" },
  { key: "soft", label: "Soft", description: "따뜻한 파스텔 그라디언트 + 반투명 패널" },
];
const ASPECT_OPTIONS: { key: CarouselAspectRatio; label: string }[] = [
  { key: "4:5", label: "4:5 (1080×1350)" },
  { key: "1:1", label: "1:1 (1080×1080)" },
];
const TEXT_POSITION_LABEL: Record<CarouselCard["textPosition"], string> = { top: "상", middle: "중", bottom: "하" };
const TEXT_ALIGN_LABEL: Record<CarouselCard["textAlign"], string> = { left: "좌", center: "중앙", right: "우" };
const HEADLINE_SIZE_LABEL: Record<CarouselCard["headlineSize"], string> = { small: "작게", medium: "보통", large: "크게" };
const ROLE_LABEL: Record<CarouselCard["role"], string> = {
  cover: "표지",
  product: "제품",
  detail: "디테일",
  usage: "사용",
  feature: "특징",
  experience: "경험",
  closing: "마무리",
};

const DEFAULT_PROJECT_META = { textPosition: "bottom" as const, textAlign: "center" as const, headlineSize: "medium" as const };

function CardCanvasPreview({
  card,
  photo,
  template,
  aspectRatio,
}: {
  card: CarouselCard;
  photo: PhotoWithUrl | undefined;
  template: CarouselTemplate;
  aspectRatio: CarouselAspectRatio;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!photo) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => setImgEl(img);
    img.onerror = () => setLoadError(true);
    img.src = photo.fullUrl;
  }, [photo]);

  useEffect(() => {
    if (!imgEl || !canvasRef.current) return;
    const { width, height } = ASPECT_SIZES[aspectRatio];
    renderCarouselCardToCanvas({ canvas: canvasRef.current, img: imgEl, card, template, width, height });
  }, [imgEl, card, template, aspectRatio]);

  const { width, height } = ASPECT_SIZES[aspectRatio];
  if (!photo) {
    return (
      <div className="flex aspect-[4/5] w-full items-center justify-center rounded-lg bg-zinc-100 text-xs text-zinc-400">
        사진 없음
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="flex aspect-[4/5] w-full items-center justify-center rounded-lg bg-zinc-100 text-xs text-red-500">
        사진을 불러오지 못했습니다
      </div>
    );
  }
  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="w-full rounded-lg border border-zinc-200 bg-zinc-100"
      style={{ aspectRatio: `${width} / ${height}` }}
    />
  );
}

export function CarouselStudio({
  collaborationId,
  photos,
  reviewNotes,
  collaborationInfo,
  guideAnalysis,
  initial,
}: {
  collaborationId: string;
  photos: PhotoWithUrl[];
  reviewNotes: ReviewNotes;
  collaborationInfo: CollaborationInfo;
  guideAnalysis: GuideAnalysis | null;
  initial?: { id: string; generationInput: CarouselProject | null };
}) {
  const router = useRouter();
  const photoById = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos]);

  const [project, setProject] = useState<CarouselProject | null>(initial?.generationInput ?? null);
  const [savedId, setSavedId] = useState<string | null>(initial?.id ?? null);
  const [planning, setPlanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const [renderState, setRenderState] = useState<"idle" | "rendering" | "done" | "error">("idle");
  const [renderProgress, setRenderProgress] = useState<{ done: number; total: number } | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [renderedCards, setRenderedCards] = useState<Record<string, { url: string; size: number }>>({});
  const [renderedForCards, setRenderedForCards] = useState<string | null>(null);
  const renderingRef = useRef(false);
  const blobsRef = useRef<Map<string, Blob>>(new Map());
  const [zipping, setZipping] = useState(false);

  const analyzedPhotoCount = photos.filter((p) => p.ai_analysis).length;
  const unanalyzedPhotoCount = photos.length - analyzedPhotoCount;

  const cardsSnapshotKey = project ? JSON.stringify([project.cards, project.template, project.aspectRatio]) : null;
  const renderStale = renderState === "done" && renderedForCards !== null && renderedForCards !== cardsSnapshotKey;

  useEffect(() => {
    return () => {
      Object.values(renderedCards).forEach((r) => URL.revokeObjectURL(r.url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleGeneratePlan() {
    setPlanning(true);
    setError(null);
    try {
      const analyzed = photos.filter((p) => p.ai_analysis);
      if (analyzed.length === 0) {
        throw new Error("먼저 사진을 추가하고 분석해주세요.");
      }
      const photoSummaries: CarouselPhotoSummary[] = analyzed.map((p) => ({
        id: p.id,
        description: p.ai_analysis as string,
      }));

      const { systemPrompt, prompt, responseSchema } = buildCarouselPlanPrompt({
        brandName: collaborationInfo.brandName,
        productName: collaborationInfo.productName,
        requiredKeywords: collaborationInfo.requiredKeywords,
        requiredHashtags: collaborationInfo.requiredHashtags,
        contentGuide: collaborationInfo.contentGuide,
        guideRawContent: collaborationInfo.guideRawContent,
        reviewNotes,
        styleSamples: collaborationInfo.styleSamples,
        photos: photoSummaries,
      });
      const raw = await callGenerate({
        systemPrompt,
        prompt,
        collaborationId,
        endpoint: "/api/ai/carousel-plan",
        responseSchema,
      });
      const parsed = parseJsonResponse<{
        cards: { photoId: string; role: string; headline: string; body: string }[];
      }>(raw);

      const VALID_ROLES = new Set<CarouselCard["role"]>([
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
            role: VALID_ROLES.has(c.role as CarouselCard["role"]) ? (c.role as CarouselCard["role"]) : "detail",
            headline: c.headline ?? "",
            body: c.body ?? "",
            included: true,
            ...DEFAULT_PROJECT_META,
          };
        })
        .filter((c): c is CarouselCard => c !== null);

      if (cards.length === 0) throw new Error("AI가 유효한 카드를 만들지 못했습니다. 다시 시도해주세요.");

      setProject({
        cards,
        template: project?.template ?? "clean",
        aspectRatio: project?.aspectRatio ?? "4:5",
        guideTextAtGeneration: collaborationInfo.guideRawContent ?? null,
      });
      setDirty(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "카드뉴스 구성에 실패했습니다.");
    } finally {
      setPlanning(false);
    }
  }

  function updateCard(id: string, patch: Partial<CarouselCard>) {
    setProject((p) => (p ? { ...p, cards: p.cards.map((c) => (c.id === id ? { ...c, ...patch } : c)) } : p));
    setDirty(true);
  }

  function moveCard(index: number, direction: -1 | 1) {
    setProject((p) => {
      if (!p) return p;
      const target = index + direction;
      if (target < 0 || target >= p.cards.length) return p;
      const next = [...p.cards];
      [next[index], next[target]] = [next[target], next[index]];
      return { ...p, cards: next };
    });
    setDirty(true);
  }

  function setTemplate(template: CarouselTemplate) {
    setProject((p) => (p ? { ...p, template } : p));
    setDirty(true);
  }
  function setAspectRatio(aspectRatio: CarouselAspectRatio) {
    setProject((p) => (p ? { ...p, aspectRatio } : p));
    setDirty(true);
  }

  async function handleSave() {
    if (!project) return;
    setSaving(true);
    setError(null);
    try {
      const result = await saveCarouselProject({ collaborationId, contentId: savedId, project });
      if ("error" in result) throw new Error(result.error);
      setSavedId(result.id);
      setDirty(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  // Mirrors STEP40's handleRender guard pattern exactly: a synchronous ref
  // check so a rapid double-click can't start two overlapping render passes.
  async function handleRenderAll() {
    if (renderingRef.current || !project) return;
    const included = project.cards.filter((c) => c.included);
    if (included.length === 0) {
      setRenderError("포함된 카드가 없습니다.");
      return;
    }
    renderingRef.current = true;
    setRenderState("rendering");
    setRenderError(null);
    setRenderProgress({ done: 0, total: included.length });
    Object.values(renderedCards).forEach((r) => URL.revokeObjectURL(r.url));
    blobsRef.current.clear();
    const snapshot = cardsSnapshotKey;

    try {
      const next: Record<string, { url: string; size: number }> = {};
      for (let i = 0; i < included.length; i++) {
        const card = included[i];
        const photo = photoById.get(card.photoId);
        if (!photo) throw new Error(`사진을 찾을 수 없습니다 (카드 ${i + 1}).`);
        const blob = await renderCarouselCardToPngBlob({ card, photo, template: project.template, aspectRatio: project.aspectRatio });
        blobsRef.current.set(card.id, blob);
        next[card.id] = { url: URL.createObjectURL(blob), size: blob.size };
        setRenderProgress({ done: i + 1, total: included.length });
      }
      setRenderedCards(next);
      setRenderedForCards(snapshot);
      setRenderState("done");
    } catch (err) {
      setRenderError(err instanceof Error ? err.message : "PNG 생성에 실패했습니다.");
      setRenderState("error");
    } finally {
      renderingRef.current = false;
      renderProgressCleanup();
    }
  }
  function renderProgressCleanup() {
    setRenderProgress(null);
  }

  function downloadCard(cardId: string, index: number) {
    const rendered = renderedCards[cardId];
    if (!rendered) return;
    const a = document.createElement("a");
    a.href = rendered.url;
    a.download = `crevena-carousel-${String(index + 1).padStart(2, "0")}.png`;
    a.click();
  }

  async function handleDownloadAll() {
    if (!project) return;
    setZipping(true);
    try {
      const included = project.cards.filter((c) => c.included);
      const files = included
        .map((card, i) => {
          const blob = blobsRef.current.get(card.id);
          if (!blob) return null;
          return { name: `crevena-carousel-${String(i + 1).padStart(2, "0")}.png`, data: blob };
        })
        .filter((f): f is { name: string; data: Blob } => f !== null);
      const zip = await createZipBlob(files);
      const url = URL.createObjectURL(zip);
      const a = document.createElement("a");
      a.href = url;
      a.download = "crevena-carousel.png.zip";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "전체 다운로드에 실패했습니다.");
    } finally {
      setZipping(false);
    }
  }

  const includedCards = project?.cards.filter((c) => c.included) ?? [];

  // Instagram Carousel has no title field, so this is called the same way
  // Instagram/Threads already call it (no `title` key at all) — see STEP37's
  // fix in checkAgainstGuideAnalysis for why that guard matters.
  const combinedText = includedCards.map((c) => `${c.headline} ${c.body}`).join(" ");
  const guideItems = useMemo(() => {
    if (includedCards.length === 0) return [];
    if (guideAnalysis) {
      return checkAgainstGuideAnalysis({ body: combinedText }, guideAnalysis, { photoCount: includedCards.length });
    }
    const det = checkContentDeterministic(combinedText, {
      requiredKeywords: collaborationInfo.requiredKeywords,
      requiredHashtags: collaborationInfo.requiredHashtags,
      requiredMentions: collaborationInfo.requiredMentions,
      adDisclosureText: collaborationInfo.adDisclosureText,
    });
    return buildDeterministicGuideItems(det, {
      requiredKeywords: collaborationInfo.requiredKeywords,
      requiredHashtags: collaborationInfo.requiredHashtags,
      requiredMentions: collaborationInfo.requiredMentions,
      adDisclosureText: collaborationInfo.adDisclosureText,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combinedText, guideAnalysis, includedCards.length]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-900">카드뉴스 (V1)</h2>
        {dirty && <span className="text-[11px] text-amber-600">● 저장되지 않은 변경사항</span>}
      </div>
      <p className="text-xs text-zinc-500">
        AI 카드뉴스 메이커 V1 — 기존 사진과 사진 분석 결과를 그대로 사용합니다. 사진을 다시 업로드할 필요는 없습니다.
      </p>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      )}

      {unanalyzedPhotoCount > 0 && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          △ 분석되지 않은 사진 {unanalyzedPhotoCount}장은 카드뉴스 구성에 사용되지 않습니다. &quot;사진 준비&quot;
          섹션에서 먼저 분석해주세요.
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleGeneratePlan}
          disabled={planning || analyzedPhotoCount === 0}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {planning ? "카드 구성 생성 중..." : project ? "AI 카드 구성 다시 만들기" : "AI 카드뉴스 만들기"}
        </button>
        <span className="text-[11px] text-zinc-400">{OPERATION_CREDIT_COST.CAROUSEL_PLAN} 크레딧 사용</span>
      </div>

      {project && (
        <>
          <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
            <p className="text-xs font-semibold text-zinc-500">디자인 템플릿</p>
            <div className="flex flex-wrap gap-2">
              {TEMPLATE_OPTIONS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTemplate(t.key)}
                  title={t.description}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                    project.template === t.key ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 text-zinc-700"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <p className="text-xs font-semibold text-zinc-500">출력 비율</p>
            <div className="flex flex-wrap gap-2">
              {ASPECT_OPTIONS.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  onClick={() => setAspectRatio(a.key)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                    project.aspectRatio === a.key ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 text-zinc-700"
                  }`}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {project.cards.map((card, i) => {
              const photo = photoById.get(card.photoId);
              return (
                <div key={card.id} className={`flex flex-col gap-3 rounded-xl border p-3 sm:flex-row ${card.included ? "border-zinc-200 bg-white" : "border-zinc-100 bg-zinc-50 opacity-60"}`}>
                  <div className="w-full shrink-0 sm:w-40">
                    <CardCanvasPreview card={card} photo={photo} template={project.template} aspectRatio={project.aspectRatio} />
                  </div>
                  <div className="flex flex-1 flex-col gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-zinc-500">
                        {i + 1}/{project.cards.length} · {ROLE_LABEL[card.role]}
                      </span>
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => moveCard(i, -1)} disabled={i === 0} className="rounded border border-zinc-300 px-1.5 py-0.5 text-xs disabled:opacity-30">↑</button>
                        <button type="button" onClick={() => moveCard(i, 1)} disabled={i === project.cards.length - 1} className="rounded border border-zinc-300 px-1.5 py-0.5 text-xs disabled:opacity-30">↓</button>
                        <label className="ml-1 flex items-center gap-1 text-xs text-zinc-600">
                          <input type="checkbox" checked={card.included} onChange={(e) => updateCard(card.id, { included: e.target.checked })} className="h-3.5 w-3.5" />
                          사용
                        </label>
                      </div>
                    </div>

                    <label className="flex flex-col gap-1 text-xs">
                      <span className="text-zinc-500">사진 변경</span>
                      <select
                        value={card.photoId}
                        onChange={(e) => updateCard(card.id, { photoId: e.target.value })}
                        className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
                      >
                        {photos.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.photo_type ?? "사진"} ({p.id.slice(0, 8)})
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="flex flex-col gap-1 text-xs">
                      <span className="text-zinc-500">headline</span>
                      <input
                        value={card.headline}
                        onChange={(e) => updateCard(card.id, { headline: e.target.value })}
                        className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs">
                      <span className="text-zinc-500">body</span>
                      <textarea
                        rows={2}
                        value={card.body}
                        onChange={(e) => updateCard(card.id, { body: e.target.value })}
                        className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
                      />
                    </label>

                    <div className="flex flex-wrap gap-3 text-xs">
                      <label className="flex items-center gap-1">
                        <span className="text-zinc-500">위치</span>
                        <select
                          value={card.textPosition}
                          onChange={(e) => updateCard(card.id, { textPosition: e.target.value as CarouselCard["textPosition"] })}
                          className="rounded border border-zinc-300 px-1.5 py-1"
                        >
                          {(Object.keys(TEXT_POSITION_LABEL) as CarouselCard["textPosition"][]).map((k) => (
                            <option key={k} value={k}>{TEXT_POSITION_LABEL[k]}</option>
                          ))}
                        </select>
                      </label>
                      <label className="flex items-center gap-1">
                        <span className="text-zinc-500">정렬</span>
                        <select
                          value={card.textAlign}
                          onChange={(e) => updateCard(card.id, { textAlign: e.target.value as CarouselCard["textAlign"] })}
                          className="rounded border border-zinc-300 px-1.5 py-1"
                        >
                          {(Object.keys(TEXT_ALIGN_LABEL) as CarouselCard["textAlign"][]).map((k) => (
                            <option key={k} value={k}>{TEXT_ALIGN_LABEL[k]}</option>
                          ))}
                        </select>
                      </label>
                      <label className="flex items-center gap-1">
                        <span className="text-zinc-500">헤드라인 크기</span>
                        <select
                          value={card.headlineSize}
                          onChange={(e) => updateCard(card.id, { headlineSize: e.target.value as CarouselCard["headlineSize"] })}
                          className="rounded border border-zinc-300 px-1.5 py-1"
                        >
                          {(Object.keys(HEADLINE_SIZE_LABEL) as CarouselCard["headlineSize"][]).map((k) => (
                            <option key={k} value={k}>{HEADLINE_SIZE_LABEL[k]}</option>
                          ))}
                        </select>
                      </label>
                    </div>

                    {renderState === "done" && !renderStale && renderedCards[card.id] && (
                      <a
                        href={renderedCards[card.id].url}
                        download={`crevena-carousel-${String(i + 1).padStart(2, "0")}.png`}
                        onClick={(e) => {
                          e.preventDefault();
                          downloadCard(card.id, i);
                        }}
                        className="self-start rounded-lg border border-zinc-300 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100"
                      >
                        PNG 다운로드 ({(renderedCards[card.id].size / 1024).toFixed(0)}KB)
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-3">
            <button type="button" onClick={handleSave} disabled={saving} className="self-start rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-100 disabled:opacity-40">
              {saving ? "저장 중..." : "저장"}
            </button>
          </div>

          {guideItems.length > 0 && (
            <div className="rounded-xl border border-zinc-200 bg-white p-3">
              <GuideCheckList items={guideItems} />
            </div>
          )}

          <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
            <p className="text-xs font-semibold text-zinc-500">PNG 만들기</p>
            <p className="text-[11px] text-zinc-400">이 브라우저에서 직접 이미지를 만듭니다 (서버 업로드 없음).</p>
            {renderStale && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
                △ 카드뉴스가 변경되었습니다. 이미지를 다시 만들어주세요.
              </p>
            )}
            {renderError && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">{renderError}</p>
            )}
            <button
              type="button"
              onClick={handleRenderAll}
              disabled={renderState === "rendering" || includedCards.length === 0}
              className="self-start rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            >
              {renderState === "rendering"
                ? `이미지 생성 중... (${renderProgress ? renderProgress.done : 0}/${includedCards.length})`
                : renderState === "done" && !renderStale
                  ? "PNG 다시 만들기"
                  : "PNG 만들기"}
            </button>
            {renderState === "done" && !renderStale && (
              <button
                type="button"
                onClick={handleDownloadAll}
                disabled={zipping}
                className="self-start rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-100 disabled:opacity-40"
              >
                {zipping ? "압축 중..." : `전체 다운로드 (ZIP, ${includedCards.length}장)`}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
