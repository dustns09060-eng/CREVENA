"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useVideoManager, MAX_VIDEO_COUNT, ACCEPTED_VIDEO_TYPES, type VideoWithUrl } from "./useVideoManager";
import {
  saveReelsProject,
  type ReelsProject,
  type ReelsScene,
  type ShortFormPlatform,
} from "./actions";
import {
  buildReelsPlanPrompt,
  buildNaverClipPlanPrompt,
  parseJsonResponse,
  type ReelsMediaSummary,
} from "@/lib/ai/reels-prompts";
import { ShortFormEditor, DEFAULT_CAPTION_STYLE } from "./ShortFormEditor";
import { OPERATION_CREDIT_COST } from "@/lib/ai/credits";
import type { ReviewNotes, StyleSample } from "@/lib/ai/prompts";
import type { CollaborationPhoto } from "@/types/database";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { CopyButton } from "@/components/CopyButton";

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

// STEP47: repairs duplicate scene ids in an already-saved project (see the
// useState call that uses it). Pure — returns the same object when there is
// nothing to fix, so a pre-existing project never re-renders for no reason.
function withUniqueSceneIds(project: ReelsProject): ReelsProject {
  const seen = new Set<string>();
  let changed = false;
  const scenes = project.scenes.map((s, i) => {
    if (!seen.has(s.id)) {
      seen.add(s.id);
      return s;
    }
    changed = true;
    return { ...s, id: `${i}-${s.mediaType}:${s.mediaId}` };
  });
  return changed ? { ...project, scenes } : project;
}

// STEP46: 네이버 클립은 릴스와 편집 흐름(장면 구성 → 편집 → 미리보기 →
// MP4)이 동일해서 스튜디오를 새로 만들지 않고 이 컴포넌트를 그대로 쓴다.
// 플랫폼마다 다른 부분만 여기 모아두고, 렌더러(render.ts)·장면 편집 UI·
// 미리보기·이중 클릭 가드는 100% 공유한다.
//
// 제품 원칙: CREVENA는 네이버에 자동 업로드하지 않는다. 문구는 전부
// "직접 올릴 때 쓸 재료를 만든다"는 사실 그대로만 쓴다.
const PLATFORM_CONFIG: Record<
  ShortFormPlatform,
  {
    heading: string;
    intro: string;
    generateLabel: string;
    regenerateLabel: string;
    downloadPrefix: string;
    showPublishCopy: boolean;
  }
> = {
  REELS: {
    heading: "Reels (V1)",
    intro:
      "AI 릴스 메이커 V1 — 장면 구성/자막/미리보기와 MP4 만들기를 지원합니다.",
    generateLabel: "AI 릴스 만들기",
    regenerateLabel: "AI 구성 다시 만들기",
    downloadPrefix: "reels",
    showPublishCopy: false,
  },
  NAVER_CLIP: {
    heading: "네이버 클립 (V1)",
    intro:
      "네이버 클립용 콘텐츠 제작 — 장면 구성/자막/미리보기, 세로형 MP4 다운로드, 게시 문구 복사까지 도와드립니다. CREVENA가 네이버에 대신 올리지는 않습니다. 만들어진 MP4와 게시 문구를 받아서 네이버 앱에서 직접 업로드해주세요.",
    generateLabel: "AI 클립 만들기",
    regenerateLabel: "AI 구성 다시 만들기",
    downloadPrefix: "naver-clip",
    showPublishCopy: true,
  },
};

export function ReelsStudio({
  collaborationId,
  photos,
  initialVideos,
  reviewNotes,
  collaborationInfo,
  initial,
  platform = "REELS",
}: {
  collaborationId: string;
  photos: PhotoWithUrl[];
  initialVideos: VideoWithUrl[];
  reviewNotes: ReviewNotes;
  collaborationInfo: CollaborationInfo;
  initial?: { id: string; generationInput: ReelsProject | null };
  // STEP46: 기본값이 "REELS" 라서 기존 릴스 호출부는 그대로 동작한다.
  platform?: ShortFormPlatform;
}) {
  const router = useRouter();
  const config = PLATFORM_CONFIG[platform];
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

  // STEP47 fix: projects saved BEFORE the unique-scene-id fix below can
  // contain two scenes sharing one `photo:<id>` id (the AI may reuse a photo
  // across scenes). Left as-is they produce a React duplicate-key warning
  // AND a real bug — editing one of those scenes edits the other, since
  // updateScene/removeScene match on id. Repaired once on load; nothing is
  // added, removed or reordered, only the id field is made unique.
  const [project, setProject] = useState<ReelsProject | null>(
    initial?.generationInput ? withUniqueSceneIds(initial.generationInput) : null,
  );
  const [savedId, setSavedId] = useState<string | null>(initial?.id ?? null);
  const [targetDuration, setTargetDuration] = useState<15 | 30 | 60>(
    initial?.generationInput?.targetDurationSeconds ?? 30,
  );
  const [planning, setPlanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [libraryDirty, setLibraryDirty] = useState(false);

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

      // STEP46: 네이버 클립은 장면 + 게시 문구 + 해시태그를 한 번의 호출로
      // 받는다. 엔드포인트가 동일한 /api/ai/reels-plan 이므로 과금도 기존
      // REELS_PLAN 그대로다 — 새 유료 오퍼레이션을 만들지 않았다.
      const buildPlanPrompt = platform === "NAVER_CLIP" ? buildNaverClipPlanPrompt : buildReelsPlanPrompt;
      const { systemPrompt, prompt, responseSchema } = buildPlanPrompt({
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
      const parsed = parseJsonResponse<{
        scenes: { mediaId: string; durationSeconds: number; caption: string }[];
        publishCopy?: string;
        hashtags?: string[];
      }>(raw);

      const scenes: ReelsScene[] = parsed.scenes
        .map((s, i): ReelsScene | null => {
          const [mediaType, mediaId] = s.mediaId.split(":") as ["photo" | "video", string];
          if (mediaType === "photo" && !photoById.has(mediaId)) return null;
          if (mediaType === "video" && !videoById.has(mediaId)) return null;
          const video = mediaType === "video" ? videoById.get(mediaId) : undefined;
          const duration = Math.max(0.5, s.durationSeconds || 2);
          return {
            // STEP47 fix (found in real testing): scene.id is the identity
            // updateScene/removeScene and the React key both use, so it must
            // be unique PER SCENE, not per media. The AI legitimately reuses
            // the same photo in two scenes — which became common once AI
            // Photo Select narrowed the pool from every uploaded photo to
            // the recommended few — and the old `photo:<id>` id then made
            // editing one scene's caption/duration silently edit the other.
            // Same `<index>-<mediaKey>` shape CarouselStudio already uses.
            id: `${i}-${s.mediaId}`,
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
        // STEP46: 게시 문구/해시태그는 네이버 클립에서만 생성된다.
        ...(config.showPublishCopy
          ? {
              publishCopy: parsed.publishCopy ?? "",
              hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags : [],
            }
          : {}),
      });
      setLibraryDirty(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "릴스 구성에 실패했습니다.");
    } finally {
      setPlanning(false);
    }
  }

  function updatePublishCopy(value: string) {
    setProject((p) => (p ? { ...p, publishCopy: value } : p));
    setLibraryDirty(true);
  }

  function updateHashtags(tags: string[]) {
    setProject((p) => (p ? { ...p, hashtags: tags } : p));
    setLibraryDirty(true);
  }

  async function handleSave() {
    if (!project) return;
    setSaving(true);
    setError(null);
    try {
      const result = await saveReelsProject({ collaborationId, contentId: savedId, project, platform });
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

  // STEP46: 복사 버튼은 게시 문구 + 해시태그를 한 덩어리로 넘겨준다 —
  // 사용자가 네이버 앱에 한 번만 붙여넣으면 되도록.
  const publishCopyFullText = [project?.publishCopy?.trim(), (project?.hashtags ?? []).join(" ").trim()]
    .filter((part) => part && part.length > 0)
    .join("\n\n");

  // 가이드에 필수 해시태그가 지정되어 있으면, 최종 해시태그 목록에 살아남았는지
  // 확인해서 빠진 것만 경고한다(가이드 체크 원칙 재사용 — 자동으로 끼워넣지
  // 않고 사용자가 확인하게 한다).
  const missingRequiredHashtags = (() => {
    if (!config.showPublishCopy) return [];
    const required = (collaborationInfo.requiredHashtags ?? "")
      .split(/[\s,]+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
      .map((t) => (t.startsWith("#") ? t : `#${t}`));
    if (required.length === 0) return [];
    const currentText = [(project?.hashtags ?? []).join(" "), project?.publishCopy ?? ""]
      .join(" ")
      .toLowerCase();
    return required.filter((t) => !currentText.includes(t.toLowerCase()));
  })();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-900">{config.heading}</h2>
        {project && <span className="text-xs text-zinc-400">{libraryDirty ? "● 저장되지 않은 변경사항" : "✓ 저장됨"}</span>}
      </div>

      <p className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-500">{config.intro}</p>

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
            {project ? config.regenerateLabel : config.generateLabel}
          </Button>
          <span className="text-[11px] text-zinc-400">{OPERATION_CREDIT_COST.REELS_PLAN} 크레딧 사용</span>
        </div>
        {/* STEP46: 미디어가 아예 없는 경우와, 올렸지만 아직 AI 분석 전인
            경우를 구분해서 안내한다. 예전에는 둘 다 "분석 완료가 필요합니다"로
            뭉뚱그려져서, 사진이 0장인 사용자에게 무엇을 해야 하는지 알려주지
            못했다. 어느 쪽이든 에러가 아니라 안내 문구로 처리한다. */}
        {readyMediaCount === 0 &&
          (photos.length === 0 && videos.length === 0 ? (
            <p className="mt-1 text-[11px] text-zinc-500">
              {platform === "NAVER_CLIP"
                ? "클립을 만들 사진이나 영상을 먼저 추가해주세요."
                : "릴스를 만들 사진이나 영상을 먼저 추가해주세요."}
            </p>
          ) : (
            <p className="mt-1 text-[11px] text-zinc-400">
              사진(AI 분석 완료) 또는 영상(AI 영상 분석 완료)이 1개 이상 필요합니다.
            </p>
          ))}
      </div>

      {project && (
        <ShortFormEditor
          project={project}
          onProjectChange={(updater) => {
            setProject((p) => (p ? updater(p) : p));
            setLibraryDirty(true);
          }}
          photoById={photoById}
          videoById={videoById}
          dirty={libraryDirty}
          saving={saving}
          onSave={handleSave}
          downloadFileName={`${config.downloadPrefix}-${collaborationId}.mp4`}
          renderNote={
            platform === "NAVER_CLIP"
              ? " 만들어진 MP4는 기기에 저장만 됩니다 — 네이버에는 자동으로 올라가지 않으니, 다운로드한 뒤 네이버 앱에서 직접 업로드해주세요."
              : ""
          }
        />
      )}

      {/* STEP46: 게시 문구 — 네이버 클립에서만 표시. 자동 업로드가 아니라,
          사용자가 네이버 앱에서 직접 올릴 때 복사해서 쓰는 텍스트다. */}
      {config.showPublishCopy && project && (
        <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Badge tone="brand">3단계 · 게시 문구</Badge>
            <CopyButton text={publishCopyFullText} />
          </div>
          <p className="text-[11px] text-zinc-400">
            네이버에 클립을 올릴 때 붙여넣어 쓰는 문구입니다. CREVENA가 대신 올리지 않으니, 아래 문구를 복사한 뒤
            네이버 앱에서 직접 업로드해주세요. 자유롭게 수정할 수 있습니다.
          </p>
          <textarea
            rows={5}
            value={project.publishCopy ?? ""}
            onChange={(e) => updatePublishCopy(e.target.value)}
            placeholder="게시 문구"
            className="rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm outline-none focus:border-zinc-900"
          />
          <label className="flex flex-col gap-1 text-xs text-zinc-600">
            해시태그 (띄어쓰기로 구분)
            <input
              type="text"
              value={(project.hashtags ?? []).join(" ")}
              onChange={(e) =>
                updateHashtags(e.target.value.split(/\s+/).filter((t) => t.trim().length > 0))
              }
              placeholder="#해시태그"
              className="rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm outline-none focus:border-zinc-900"
            />
          </label>
          {missingRequiredHashtags.length > 0 && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
              △ 가이드의 필수 해시태그가 빠졌습니다: {missingRequiredHashtags.join(" ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
