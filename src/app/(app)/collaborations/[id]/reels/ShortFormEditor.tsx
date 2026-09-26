"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReelsProject, ReelsScene, ReelsCaptionStyle } from "./actions";
import type { VideoWithUrl } from "./useVideoManager";
import { renderReelsToMp4, type RenderProgress, type RenderablePhoto } from "./render";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

// Extracted verbatim from ReelsStudio (scene cards, 9:16 preview, caption
// style, save button, MP4 step) so Product Shorts can share the exact same
// editor + renderer. Everything collaboration-specific (AI plan generation,
// video upload, publishCopy/hashtags, persistence target) stays with the
// caller. This component only edits the ReelsProject it is given via
// onProjectChange, and never calls AI or touches the DB.

export type EditorPhoto = RenderablePhoto & { thumbUrl: string };

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

export const DEFAULT_CAPTION_STYLE: ReelsCaptionStyle = { preset: "basic", position: "bottom", size: "medium" };

export function ShortFormEditor({
  project,
  onProjectChange,
  photoById,
  videoById,
  dirty,
  saving,
  onSave,
  downloadFileName,
  renderNote = "",
  onBeforeRender,
}: {
  project: ReelsProject;
  onProjectChange: (updater: (p: ReelsProject) => ReelsProject) => void;
  photoById: Map<string, EditorPhoto>;
  videoById: Map<string, VideoWithUrl>;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  downloadFileName: string;
  renderNote?: string;
  // Optional hook for callers whose media URLs can expire (Product Shorts'
  // signed URLs). Called right before each render; returns fresh photo URLs,
  // or null if they could not be refreshed. Reels/Naver Clip do not pass it,
  // so their render path is unchanged.
  onBeforeRender?: () => Promise<Map<string, EditorPhoto> | null>;
}) {
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
  const renderStale = renderState === "done" && renderedForScenes !== null && renderedForScenes !== JSON.stringify(project.scenes);

  useEffect(() => {
    return () => {
      if (renderedUrl) URL.revokeObjectURL(renderedUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const captionStyle = project.captionStyle ?? DEFAULT_CAPTION_STYLE;

  function updateScene(id: string, patch: Partial<ReelsScene>) {
    onProjectChange((p) => ({ ...p, scenes: p.scenes.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
  }

  function removeScene(id: string) {
    onProjectChange((p) => ({ ...p, scenes: p.scenes.filter((s) => s.id !== id) }));
  }

  function moveScene(index: number, direction: -1 | 1) {
    onProjectChange((p) => {
      const target = index + direction;
      if (target < 0 || target >= p.scenes.length) return p;
      const next = [...p.scenes];
      [next[index], next[target]] = [next[target], next[index]];
      return { ...p, scenes: next };
    });
  }

  function updateCaptionStyle(patch: Partial<ReelsCaptionStyle>) {
    onProjectChange((p) => ({ ...p, captionStyle: { ...captionStyle, ...patch } }));
  }

  // STEP40 item 14: a synchronous ref guard (same pattern as
  // PhotoBlogStudio's writingRef) so a rapid double-click can't start two
  // overlapping renders before the disabled-button re-render lands.
  async function handleRender() {
    if (renderingRef.current) return;
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
      let photosForRender = photoById;
      if (onBeforeRender) {
        const fresh = await onBeforeRender();
        if (!fresh) throw new Error("사진 주소를 새로 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
        photosForRender = fresh;
      }
      const blob = await renderReelsToMp4({
        scenes: included,
        photoById: photosForRender,
        videoById,
        captionStyle,
        onProgress: setRenderProgress,
      });
      setRenderedUrl(URL.createObjectURL(blob));
      setRenderedSize(blob.size);
      setRenderedForScenes(scenesSnapshot);
      setRenderState("done");
    } catch (err) {
      // The renderer's own errors are Korean user messages; anything else
      // (a raw browser/codec error) is replaced with a generic Korean one so
      // no English error text or internals reach the user.
      setRenderError(err instanceof Error && /[가-힣]/.test(err.message) ? err.message : "렌더링에 실패했습니다. 잠시 후 다시 시도해주세요.");
      setRenderState("error");
    } finally {
      renderingRef.current = false;
      setRenderProgress(null);
    }
  }

  const includedScenes = useMemo(() => project.scenes.filter((s) => s.included), [project.scenes]);
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
                {video && <video src={video.url} className="h-20 w-20 rounded-lg object-cover" muted />}
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
                  {/* STEP46: 장면 삭제. 기존에는 "사용" 체크 해제로 제외만
                      가능해서 목록이 계속 길어졌다. 미디어 자체는 지우지
                      않고 이 구성안에서만 빼는 것이므로, 다시 넣고 싶으면
                      "AI 구성 다시 만들기"로 복구된다. */}
                  <button
                    type="button"
                    onClick={() => removeScene(scene.id)}
                    className="text-xs text-red-500 hover:text-red-600"
                  >
                    삭제
                  </button>
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

        <Button size="sm" variant="secondary" onClick={onSave} disabled={saving || !dirty} loading={saving} loadingText="저장 중...">
          저장
        </Button>

        <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
          <Badge tone="brand">2단계 · MP4 만들기</Badge>
          <p className="text-[11px] text-zinc-400">
            이 브라우저에서 직접 영상을 만듭니다 (서버 업로드 없음). 오디오는 아직 지원하지 않아 무음으로
            만들어집니다. 위 장면 구성(1단계)과는 별개의 단계로, 장면을 먼저 완성한 뒤 눌러주세요.
            {renderNote}
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
              download={downloadFileName}
              className="self-start rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-100"
            >
              ✓ 완료 — MP4 다운로드 {renderedSize ? `(${(renderedSize / 1024 / 1024).toFixed(1)}MB)` : ""}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
