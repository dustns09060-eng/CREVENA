"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useVideoManager, MAX_VIDEO_COUNT, ACCEPTED_VIDEO_TYPES, type VideoWithUrl } from "./useVideoManager";
import { saveReelsProject, type ReelsProject, type ReelsScene, type ReelsCaptionStyle } from "./actions";
import { buildReelsPlanPrompt, parseJsonResponse, type ReelsMediaSummary } from "@/lib/ai/reels-prompts";
import { renderReelsToMp4, type RenderProgress } from "./render";
import { OPERATION_CREDIT_COST } from "@/lib/ai/credits";
import type { ReviewNotes, StyleSample } from "@/lib/ai/prompts";
import type { CollaborationPhoto } from "@/types/database";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

type PhotoWithUrl = CollaborationPhoto & { fullUrl: string; thumbUrl: string };

type CollaborationInfo = {
  brandName: string;
  productName: string;
  requiredKeywords: string | null;
  requiredHashtags: string | null;
  contentGuide: string | null;
  guideRawContent: string | null;
  styleSamples: StyleSample[];
};

const DURATION_OPTIONS: (15 | 30 | 60)[] = [15, 30, 60];
const CAPTION_PRESETS: ReelsCaptionStyle["preset"][] = ["basic", "clean", "emphasis"];
const CAPTION_PRESET_LABEL: Record<ReelsCaptionStyle["preset"], string> = {
  basic: "기본",
  clean: "깔끔",
  emphasis: "강조",
};
const CAPTION_PRESET_CLASS: Record<ReelsCaptionStyle["preset"], string> = {
  basic: "bg-black/60 text-white",
  clean: "bg-white/90 text-zinc-900",
  emphasis: "bg-yellow-300 text-black font-bold",
};
const POSITION_LABEL: Record<ReelsCaptionStyle["position"], string> = { top: "상", middle: "중", bottom: "하" };
const SIZE_LABEL: Record<ReelsCaptionStyle["size"], string> = { small: "작게", medium: "보통", large: "크게" };
const SIZE_CLASS: Record<ReelsCaptionStyle["size"], string> = {
  small: "text-xs",
  medium: "text-sm",
  large: "text-lg",
};
const POSITION_CLASS: Record<ReelsCaptionStyle["position"], string> = {
  top: "items-start pt-6",
  middle: "items-center",
  bottom: "items-end pb-6",
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

const DEFAULT_CAPTION_STYLE: ReelsCaptionStyle = { preset: "basic", position: "bottom", size: "medium" };

export function ReelsStudio({
  collaborationId,
  photos,
  initialVideos,
  reviewNotes,
  collaborationInfo,
  initial,
}: {
  collaborationId: string;
  photos: PhotoWithUrl[];
  initialVideos: VideoWithUrl[];
  reviewNotes: ReviewNotes;
  collaborationInfo: CollaborationInfo;
  initial?: { id: string; generationInput: ReelsProject | null };
}) {
  const router = useRouter();
  const videoManager = useVideoManager(collaborationId, initialVideos);
  const {
    videos,
    fileInputRef,
    uploading,
    analyzing,
    analyzeProgress,
    error: videoError,
    handleAddVideos,
    handleAnalyzeAll,
    handleDeleteVideo,
    handleMove: handleMoveVideo,
  } = videoManager;

  const [project, setProject] = useState<ReelsProject | null>(initial?.generationInput ?? null);
  const [savedId, setSavedId] = useState<string | null>(initial?.id ?? null);
  const [targetDuration, setTargetDuration] = useState<15 | 30 | 60>(
    initial?.generationInput?.targetDurationSeconds ?? 30,
  );
  const [planning, setPlanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [libraryDirty, setLibraryDirty] = useState(false);
  const [playIndex, setPlayIndex] = useState<number | null>(null);

  // STEP40: rendering is entirely client-side (no server cost, see the
  // STEP40 report) so none of this touches the DB — a render never survives
  // a reload, and that's intentional: there's no MP4 anywhere to restore.
  const [renderState, setRenderState] = useState<"idle" | "rendering" | "done" | "error">("idle");
  const [renderProgress, setRenderProgress] = useState<RenderProgress | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [renderedUrl, setRenderedUrl] = useState<string | null>(null);
  const [renderedSize, setRenderedSize] = useState<number | null>(null);
  // Snapshot of the scenes actually used for the last completed render, so
  // any later edit can be flagged stale without a native confirm() dialog.
  const [renderedForScenes, setRenderedForScenes] = useState<string | null>(null);
  const renderingRef = useRef(false);
  const renderStale = renderState === "done" && renderedForScenes !== null && renderedForScenes !== JSON.stringify(project?.scenes ?? []);

  useEffect(() => {
    return () => {
      if (renderedUrl) URL.revokeObjectURL(renderedUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const photoById = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos]);
  const videoById = useMemo(() => new Map(videos.map((v) => [v.id, v])), [videos]);

  const captionStyle = project?.captionStyle ?? DEFAULT_CAPTION_STYLE;
  const guideStale =
    !!collaborationInfo.guideRawContent &&
    project?.guideTextAtGeneration !== undefined &&
    project.guideTextAtGeneration !== collaborationInfo.guideRawContent;

  const analyzableVideoCount = videos.filter((v) => !v.frame_analysis).length;
  const readyMediaCount =
    photos.filter((p) => p.ai_analysis).length + videos.filter((v) => v.frame_analysis).length;

  async function handleGeneratePlan() {
    setPlanning(true);
    setError(null);
    try {
      const media: ReelsMediaSummary[] = [
        ...photos
          .filter((p) => p.ai_analysis)
          .map((p) => ({ id: `photo:${p.id}`, mediaType: "photo" as const, description: p.ai_analysis as string })),
        ...videos
          .filter((v) => v.frame_analysis)
          .map((v) => {
            const fa = v.frame_analysis as { summary: string; frames: { description: string }[] };
            return {
              id: `video:${v.id}`,
              mediaType: "video" as const,
              description: `${fa.summary} (${fa.frames.map((f) => f.description).join(" / ")})`,
              durationSeconds: v.duration_seconds ?? undefined,
            };
          }),
      ];
      if (media.length === 0) {
        throw new Error("먼저 사진 또는 영상을 추가하고 분석해주세요.");
      }

      const { systemPrompt, prompt, responseSchema } = buildReelsPlanPrompt({
        brandName: collaborationInfo.brandName,
        productName: collaborationInfo.productName,
        requiredKeywords: collaborationInfo.requiredKeywords,
        requiredHashtags: collaborationInfo.requiredHashtags,
        contentGuide: collaborationInfo.contentGuide,
        guideRawContent: collaborationInfo.guideRawContent,
        reviewNotes,
        styleSamples: collaborationInfo.styleSamples,
        targetDurationSeconds: targetDuration,
        media,
      });
      const raw = await callGenerate({
        systemPrompt,
        prompt,
        collaborationId,
        endpoint: "/api/ai/reels-plan",
        responseSchema,
      });
      const parsed = parseJsonResponse<{ scenes: { mediaId: string; durationSeconds: number; caption: string }[] }>(
        raw,
      );

      const scenes: ReelsScene[] = parsed.scenes
        .map((s): ReelsScene | null => {
          const [mediaType, mediaId] = s.mediaId.split(":") as ["photo" | "video", string];
          if (mediaType === "photo" && !photoById.has(mediaId)) return null;
          if (mediaType === "video" && !videoById.has(mediaId)) return null;
          const video = mediaType === "video" ? videoById.get(mediaId) : undefined;
          const duration = Math.max(0.5, s.durationSeconds || 2);
          return {
            id: s.mediaId,
            mediaType,
            mediaId,
            included: true,
            trimStart: mediaType === "video" ? 0 : undefined,
            trimEnd: mediaType === "video" ? Math.min(duration, video?.duration_seconds ?? duration) : undefined,
            durationSeconds: duration,
            caption: s.caption ?? "",
            captionVisible: true,
          };
        })
        .filter((s): s is ReelsScene => s !== null);

      if (scenes.length === 0) throw new Error("AI가 유효한 장면을 만들지 못했습니다. 다시 시도해주세요.");

      setProject({
        scenes,
        targetDurationSeconds: targetDuration,
        captionStyle,
        guideTextAtGeneration: collaborationInfo.guideRawContent ?? null,
      });
      setLibraryDirty(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "릴스 구성에 실패했습니다.");
    } finally {
      setPlanning(false);
    }
  }

  function updateScene(id: string, patch: Partial<ReelsScene>) {
    setProject((p) => (p ? { ...p, scenes: p.scenes.map((s) => (s.id === id ? { ...s, ...patch } : s)) } : p));
    setLibraryDirty(true);
  }

  function moveScene(index: number, direction: -1 | 1) {
    setProject((p) => {
      if (!p) return p;
      const target = index + direction;
      if (target < 0 || target >= p.scenes.length) return p;
      const next = [...p.scenes];
      [next[index], next[target]] = [next[target], next[index]];
      return { ...p, scenes: next };
    });
    setLibraryDirty(true);
  }

  function updateCaptionStyle(patch: Partial<ReelsCaptionStyle>) {
    setProject((p) => (p ? { ...p, captionStyle: { ...captionStyle, ...patch } } : p));
    setLibraryDirty(true);
  }

  async function handleSave() {
    if (!project) return;
    setSaving(true);
    setError(null);
    try {
      const result = await saveReelsProject({ collaborationId, contentId: savedId, project });
      if ("error" in result) throw new Error(result.error);
      setSavedId(result.id);
      setLibraryDirty(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  // STEP40 item 14: a synchronous ref guard (same pattern as
  // PhotoBlogStudio's writingRef) so a rapid double-click can't start two
  // overlapping renders before the disabled-button re-render lands.
  async function handleRender() {
    if (renderingRef.current || !project) return;
    const included = project.scenes.filter((s) => s.included);
    if (included.length === 0) {
      setRenderError("포함된 장면이 없습니다.");
      return;
    }
    renderingRef.current = true;
    setRenderState("rendering");
    setRenderError(null);
    if (renderedUrl) {
      URL.revokeObjectURL(renderedUrl);
      setRenderedUrl(null);
    }
    const scenesSnapshot = JSON.stringify(project.scenes);
    try {
      const blob = await renderReelsToMp4({
        scenes: included,
        photoById,
        videoById,
        captionStyle,
        onProgress: setRenderProgress,
      });
      setRenderedUrl(URL.createObjectURL(blob));
      setRenderedSize(blob.size);
      setRenderedForScenes(scenesSnapshot);
      setRenderState("done");
    } catch (err) {
      setRenderError(err instanceof Error ? err.message : "렌더링에 실패했습니다.");
      setRenderState("error");
    } finally {
      renderingRef.current = false;
      setRenderProgress(null);
    }
  }

  const includedScenes = project?.scenes.filter((s) => s.included) ?? [];
  const totalDuration = includedScenes.reduce((sum, s) => sum + s.durationSeconds, 0);
  const currentScene = playIndex !== null ? includedScenes[playIndex] : undefined;

  // STEP39 item 13: browser-only preview playback — cycles included scenes
  // in order using their own durationSeconds, no MP4 involved.
  useEffect(() => {
    if (playIndex === null || !currentScene) return;
    const nextIndex = playIndex + 1 < includedScenes.length ? playIndex + 1 : null;
    const timer = setTimeout(() => {
      setPlayIndex(nextIndex);
    }, currentScene.durationSeconds * 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playIndex, currentScene?.id]);

  function renderSceneMedia(scene: ReelsScene, className: string) {
    if (scene.mediaType === "photo") {
      const photo = photoById.get(scene.mediaId);
      if (!photo) return null;
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={photo.fullUrl} alt="" className={className} />;
    }
    const video = videoById.get(scene.mediaId);
    if (!video) return null;
    return (
      <video
        key={scene.id}
        src={video.url}
        className={className}
        autoPlay={playIndex !== null}
        muted
        playsInline
        onLoadedMetadata={(e) => {
          if (scene.trimStart) e.currentTarget.currentTime = scene.trimStart;
        }}
        // STEP39 production 후속 검증에서 발견: trimStart는 재생 시작점에
        // 반영되지만 trimEnd는 아무 데서도 쓰이지 않아, 미리보기가 trim
        // 종료 지점을 넘겨 재생을 계속했다. trimEnd에 도달하면 그 자리에서
        // 멈추도록(=다음 scene으로 넘어갈 때까지 정지 프레임 유지) 수정.
        onTimeUpdate={(e) => {
          if (scene.trimEnd && e.currentTarget.currentTime >= scene.trimEnd) {
            e.currentTarget.pause();
            e.currentTarget.currentTime = scene.trimEnd;
          }
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-900">Reels (V1)</h2>
        {project && <span className="text-xs text-zinc-400">{libraryDirty ? "● 저장되지 않은 변경사항" : "✓ 저장됨"}</span>}
      </div>

      <p className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
        AI 릴스 메이커 V1 — 장면 구성/자막/미리보기까지 지원합니다. 실제 MP4 렌더링은 다음 단계에서 지원 예정입니다.
      </p>

      {error && (
        <p className="whitespace-pre-wrap rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {videoError && (
        <p className="whitespace-pre-wrap rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {videoError}
        </p>
      )}
      {guideStale && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          △ 가이드가 변경되었습니다. &quot;AI 구성 다시 만들기&quot;로 최신 내용을 반영해주세요.
        </p>
      )}

      {/* 영상 업로드 */}
      <div className="rounded-xl border border-zinc-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-zinc-500">영상 ({videos.length}개)</p>
          <span className="text-[10px] text-zinc-400">
            영상 1개당 최대 100MB · 최대 {MAX_VIDEO_COUNT}개
          </span>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_VIDEO_TYPES.join(",")}
          multiple
          hidden
          onChange={(e) => handleAddVideos(e.target.files, photos.length)}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
          >
            {uploading ? "업로드 중..." : "+ 영상 추가"}
          </button>
          {analyzableVideoCount > 0 && (
            <button
              type="button"
              onClick={() => handleAnalyzeAll()}
              disabled={analyzing}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
            >
              {analyzing
                ? `영상 분석 중... (${analyzeProgress?.done ?? 0}/${analyzeProgress?.total ?? 0})`
                : `AI 영상 분석 (${OPERATION_CREDIT_COST.VIDEO_FRAME_ANALYZE} 크레딧/개)`}
            </button>
          )}
        </div>

        {videos.length > 0 && (
          <ul className="mt-3 flex flex-col gap-2">
            {videos.map((v, i) => (
              <li key={v.id} className="flex items-center gap-2 rounded-lg border border-zinc-100 p-2">
                <video src={v.url} className="h-14 w-10 shrink-0 rounded object-cover" muted />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-zinc-700">{v.original_filename ?? "영상"}</p>
                  <p className="text-[10px] text-zinc-400">
                    {v.duration_seconds ? `${v.duration_seconds.toFixed(1)}초` : "길이 확인 중"} ·{" "}
                    {v.width && v.height ? `${v.width}x${v.height}` : ""}{" "}
                    {v.frame_analysis ? "· 분석완료" : "· 미분석"}
                  </p>
                </div>
                <button onClick={() => handleMoveVideo(i, -1)} className="text-xs text-zinc-400">
                  ↑
                </button>
                <button onClick={() => handleMoveVideo(i, 1)} className="text-xs text-zinc-400">
                  ↓
                </button>
                <button onClick={() => handleDeleteVideo(v)} className="text-xs text-red-500">
                  삭제
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* AI 구성 — 1단계: 장면 구성. MP4 만들기(2단계)와는 다른 작업임을 배지로 구분 */}
      <div className="rounded-xl border border-zinc-200 bg-white p-4">
        <Badge tone="brand">1단계 · 장면 구성</Badge>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-zinc-500">목표 길이</span>
          {DURATION_OPTIONS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setTargetDuration(d)}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                targetDuration === d ? "border-brand-600 bg-brand-600 text-white" : "border-zinc-300 text-zinc-600"
              }`}
            >
              {d}초
            </button>
          ))}
        </div>

        {project && project.scenes.length > 0 && (
          <p className="mt-2 text-[11px] text-amber-700">
            △ 이미 만들어진 장면 구성이 있습니다 — 다시 만들면 직접 수정한 순서/자막이 덮어써집니다.
          </p>
        )}
        <div className="mt-2 flex items-center gap-2">
          <Button onClick={handleGeneratePlan} disabled={planning || readyMediaCount === 0} loading={planning} loadingText="구성 만드는 중...">
            {project ? "AI 구성 다시 만들기" : "AI 릴스 만들기"}
          </Button>
          <span className="text-[11px] text-zinc-400">{OPERATION_CREDIT_COST.REELS_PLAN} 크레딧 사용</span>
        </div>
        {readyMediaCount === 0 && (
          <p className="mt-1 text-[11px] text-zinc-400">
            사진(AI 분석 완료) 또는 영상(AI 영상 분석 완료)이 1개 이상 필요합니다.
          </p>
        )}
      </div>

      {project && (
        <div className="grid gap-4 lg:grid-cols-[1fr,320px]">
          {/* Scene 편집 카드 */}
          <div className="flex flex-col gap-3">
            {project.scenes.map((scene, i) => {
              const photo = scene.mediaType === "photo" ? photoById.get(scene.mediaId) : undefined;
              const video = scene.mediaType === "video" ? videoById.get(scene.mediaId) : undefined;
              return (
                <div
                  key={scene.id}
                  className={`flex flex-col gap-2 rounded-xl border p-3 sm:flex-row ${
                    scene.included ? "border-zinc-200 bg-white" : "border-zinc-100 bg-zinc-50 opacity-60"
                  }`}
                >
                  <div className="flex shrink-0 flex-col items-center gap-1 sm:w-24">
                    {photo && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={photo.thumbUrl} alt="" className="h-20 w-20 rounded-lg object-cover" />
                    )}
                    {video && (
                      <video src={video.url} className="h-20 w-20 rounded-lg object-cover" muted />
                    )}
                    <span className="text-[10px] text-zinc-400">
                      {i + 1}/{project.scenes.length}
                    </span>
                  </div>
                  <div className="flex flex-1 flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <button onClick={() => moveScene(i, -1)} className="text-xs text-zinc-400">
                        ↑ 위로
                      </button>
                      <button onClick={() => moveScene(i, 1)} className="text-xs text-zinc-400">
                        ↓ 아래로
                      </button>
                      <label className="flex items-center gap-1 text-xs text-zinc-600">
                        <input
                          type="checkbox"
                          checked={scene.included}
                          onChange={(e) => updateScene(scene.id, { included: e.target.checked })}
                        />
                        사용
                      </label>
                      <label className="ml-auto flex items-center gap-1 text-xs text-zinc-600">
                        길이(초)
                        <input
                          type="number"
                          step={0.5}
                          min={0.5}
                          value={scene.durationSeconds}
                          onChange={(e) => updateScene(scene.id, { durationSeconds: Number(e.target.value) })}
                          className="w-16 rounded border border-zinc-200 px-1.5 py-0.5"
                        />
                      </label>
                    </div>

                    {scene.mediaType === "video" && (
                      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-600">
                        <label className="flex items-center gap-1">
                          시작(초)
                          <input
                            type="number"
                            step={0.5}
                            min={0}
                            value={scene.trimStart ?? 0}
                            onChange={(e) => updateScene(scene.id, { trimStart: Number(e.target.value) })}
                            className="w-16 rounded border border-zinc-200 px-1.5 py-0.5"
                          />
                        </label>
                        <label className="flex items-center gap-1">
                          종료(초)
                          <input
                            type="number"
                            step={0.5}
                            min={0}
                            value={scene.trimEnd ?? 0}
                            onChange={(e) => updateScene(scene.id, { trimEnd: Number(e.target.value) })}
                            className="w-16 rounded border border-zinc-200 px-1.5 py-0.5"
                          />
                        </label>
                      </div>
                    )}

                    <textarea
                      rows={2}
                      value={scene.caption}
                      onChange={(e) => updateScene(scene.id, { caption: e.target.value })}
                      className="rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm outline-none focus:border-zinc-900"
                      placeholder="화면 자막"
                    />
                    <label className="flex items-center gap-1 text-xs text-zinc-600">
                      <input
                        type="checkbox"
                        checked={scene.captionVisible}
                        onChange={(e) => updateScene(scene.id, { captionVisible: e.target.checked })}
                      />
                      자막 표시
                    </label>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 9:16 미리보기 */}
          <div className="flex flex-col gap-3 lg:sticky lg:top-4 lg:self-start">
            <div className="mx-auto w-full max-w-[240px] overflow-hidden rounded-2xl border border-zinc-300 bg-black" style={{ aspectRatio: "9/16" }}>
              <div className="relative h-full w-full">
                {currentScene ? (
                  renderSceneMedia(currentScene, "h-full w-full object-cover")
                ) : includedScenes[0] ? (
                  renderSceneMedia(includedScenes[0], "h-full w-full object-cover")
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-zinc-500">
                    미리볼 장면이 없습니다
                  </div>
                )}
                {(currentScene ?? includedScenes[0])?.captionVisible && (
                  <div className={`pointer-events-none absolute inset-0 flex justify-center px-4 ${POSITION_CLASS[captionStyle.position]}`}>
                    <span
                      className={`rounded px-2 py-1 text-center ${CAPTION_PRESET_CLASS[captionStyle.preset]} ${SIZE_CLASS[captionStyle.size]}`}
                    >
                      {(currentScene ?? includedScenes[0])?.caption}
                    </span>
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center justify-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => setPlayIndex(playIndex === null ? 0 : null)} disabled={includedScenes.length === 0}>
                {playIndex === null ? "▶ 재생" : "■ 정지"}
              </Button>
              <span className="text-[11px] text-zinc-400">총 {totalDuration.toFixed(1)}초</span>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-3">
              <p className="mb-2 text-xs font-semibold text-zinc-500">자막 스타일</p>
              <div className="flex flex-wrap gap-1.5">
                {CAPTION_PRESETS.map((p) => (
                  <button
                    key={p}
                    onClick={() => updateCaptionStyle({ preset: p })}
                    className={`rounded-full border px-2.5 py-1 text-[11px] ${
                      captionStyle.preset === p ? "border-brand-600 bg-brand-600 text-white" : "border-zinc-300"
                    }`}
                  >
                    {CAPTION_PRESET_LABEL[p]}
                  </button>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(Object.keys(POSITION_LABEL) as ReelsCaptionStyle["position"][]).map((p) => (
                  <button
                    key={p}
                    onClick={() => updateCaptionStyle({ position: p })}
                    className={`rounded-full border px-2.5 py-1 text-[11px] ${
                      captionStyle.position === p ? "border-brand-600 bg-brand-600 text-white" : "border-zinc-300"
                    }`}
                  >
                    {POSITION_LABEL[p]}
                  </button>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(Object.keys(SIZE_LABEL) as ReelsCaptionStyle["size"][]).map((s) => (
                  <button
                    key={s}
                    onClick={() => updateCaptionStyle({ size: s })}
                    className={`rounded-full border px-2.5 py-1 text-[11px] ${
                      captionStyle.size === s ? "border-brand-600 bg-brand-600 text-white" : "border-zinc-300"
                    }`}
                  >
                    {SIZE_LABEL[s]}
                  </button>
                ))}
              </div>
            </div>

            <Button size="sm" variant="secondary" onClick={handleSave} disabled={saving || !libraryDirty} loading={saving} loadingText="저장 중...">
              저장
            </Button>

            <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
              <Badge tone="brand">2단계 · MP4 만들기</Badge>
              <p className="text-[11px] text-zinc-400">
                이 브라우저에서 직접 영상을 만듭니다 (서버 업로드 없음). 오디오는 아직 지원하지 않아 무음으로
                만들어집니다. 위 장면 구성(1단계)과는 별개의 단계로, 장면을 먼저 완성한 뒤 눌러주세요.
              </p>
              {renderStale && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
                  △ 영상이 변경되었습니다. MP4를 다시 만들어주세요.
                </p>
              )}
              {renderError && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">
                  {renderError}
                </p>
              )}
              <Button
                size="sm"
                className="self-start"
                onClick={handleRender}
                disabled={renderState === "rendering" || includedScenes.length === 0}
                loading={renderState === "rendering"}
                loadingText={`렌더링 중... (${renderProgress ? renderProgress.sceneIndex + 1 : 0}/${includedScenes.length}${
                  renderProgress?.stage === "finalizing" ? " · 마무리 중" : ""
                })`}
              >
                {renderState === "done" && !renderStale ? "MP4 다시 만들기" : renderError ? "다시 시도" : "MP4 만들기"}
              </Button>
              {renderState === "done" && renderedUrl && !renderStale && (
                <a
                  href={renderedUrl}
                  download={`reels-${collaborationId}.mp4`}
                  className="self-start rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-100"
                >
                  ✓ 완료 — MP4 다운로드 {renderedSize ? `(${(renderedSize / 1024 / 1024).toFixed(1)}MB)` : ""}
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
