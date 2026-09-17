"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { registerVideo, reorderVideos, deleteVideo } from "./actions";
import type { CollaborationVideo } from "@/types/database";

const VIDEO_BUCKET = "collaboration-videos";

// STEP39 item 3: V1 upload limits, decided from the technical feasibility
// review (see the STEP39 report) rather than picked arbitrarily —
// - 100MB/clip: the Storage bucket's own file_size_limit (migration 0020),
//   generous enough for a phone-shot 30-60s 1080p clip at typical bitrates
//   while keeping any one upload well clear of timeouts on a slow mobile
//   connection.
// - 10 clips / 20 total items: a 15-60s reels draft realistically only ever
//   uses a handful of clips (see item 7's scene-count guidance) — this is a
//   sanity ceiling against accidental mass-uploads, not a hard product limit.
export const MAX_VIDEO_COUNT = 10;
export const MAX_VIDEO_SIZE_BYTES = 100 * 1024 * 1024;
export const ACCEPTED_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];

export type VideoWithUrl = CollaborationVideo & { url: string };

function extractVideoMetadata(file: File): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const videoEl = document.createElement("video");
    videoEl.preload = "metadata";
    videoEl.src = url;
    videoEl.onloadedmetadata = () => {
      const meta = { duration: videoEl.duration, width: videoEl.videoWidth, height: videoEl.videoHeight };
      URL.revokeObjectURL(url);
      resolve(meta);
    };
    videoEl.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("영상 메타데이터를 읽지 못했습니다. 손상되었거나 지원하지 않는 형식일 수 있습니다."));
    };
  });
}

// STEP39 item 6/9: extracts up to 3 representative JPEG frames from a local
// video File, entirely in the browser (canvas) — the raw video is never
// uploaded anywhere for analysis purposes, only these small still frames are
// sent to the vision endpoint. Frames are transient (never written to
// Storage), so there is nothing to revoke besides the one object URL used to
// play the file for capture.
async function extractFrames(
  file: File,
  duration: number,
  timestamps: number[],
): Promise<{ timestampSeconds: number; base64Data: string }[]> {
  const url = URL.createObjectURL(file);
  try {
    const videoEl = document.createElement("video");
    videoEl.preload = "auto";
    videoEl.muted = true;
    videoEl.src = url;
    await new Promise<void>((resolve, reject) => {
      videoEl.onloadeddata = () => resolve();
      videoEl.onerror = () => reject(new Error("영상을 불러오지 못했습니다."));
    });

    const canvas = document.createElement("canvas");
    canvas.width = Math.min(videoEl.videoWidth || 640, 640);
    canvas.height = Math.round(canvas.width * ((videoEl.videoHeight || 1) / (videoEl.videoWidth || 1)));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("프레임을 추출할 수 없습니다.");

    const frames: { timestampSeconds: number; base64Data: string }[] = [];
    for (const t of timestamps) {
      const seekTo = Math.min(Math.max(t, 0), Math.max(duration - 0.1, 0));
      await new Promise<void>((resolve, reject) => {
        const onSeeked = () => {
          videoEl.removeEventListener("seeked", onSeeked);
          resolve();
        };
        videoEl.addEventListener("seeked", onSeeked);
        videoEl.onerror = () => reject(new Error("프레임 탐색에 실패했습니다."));
        videoEl.currentTime = seekTo;
      });
      ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
      frames.push({ timestampSeconds: seekTo, base64Data: dataUrl.split(",")[1] ?? "" });
    }
    return frames;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function useVideoManager(collaborationId: string, initialVideos: VideoWithUrl[]) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Local File objects, kept only for this browser session so newly
  // uploaded clips can have frames re-extracted for analysis without
  // re-downloading the video — see handleAnalyzeAll's session-only note.
  const localFilesRef = useRef<Map<string, File>>(new Map());

  const [videos, setVideos] = useState<VideoWithUrl[]>(initialVideos);
  const [syncedVideos, setSyncedVideos] = useState(initialVideos);
  if (initialVideos !== syncedVideos) {
    setSyncedVideos(initialVideos);
    setVideos(initialVideos);
  }

  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAddVideos(files: FileList | null, currentPhotoCount: number) {
    if (!files || files.length === 0) return;
    const incoming = Array.from(files);

    if (videos.length + incoming.length > MAX_VIDEO_COUNT) {
      setError(`영상은 최대 ${MAX_VIDEO_COUNT}개까지 추가할 수 있습니다.`);
      return;
    }
    if (currentPhotoCount + videos.length + incoming.length > 20) {
      setError("사진+영상을 합쳐 최대 20개까지 추가할 수 있습니다.");
      return;
    }
    for (const file of incoming) {
      if (!ACCEPTED_VIDEO_TYPES.includes(file.type)) {
        setError(`지원하지 않는 영상 형식입니다: ${file.name} (${file.type || "알 수 없음"})`);
        return;
      }
      if (file.size > MAX_VIDEO_SIZE_BYTES) {
        setError(`영상 1개당 최대 100MB까지 업로드할 수 있습니다: ${file.name}`);
        return;
      }
    }

    setUploading(true);
    setError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("로그인이 필요합니다.");

      for (const file of incoming) {
        const meta = await extractVideoMetadata(file);
        const videoId = crypto.randomUUID();
        const ext = file.name.split(".").pop()?.toLowerCase() || "mp4";
        const path = `${user.id}/${collaborationId}/${videoId}.${ext}`;

        // Direct browser -> Storage upload under the user's own session
        // (RLS-enforced by the same user_id-prefixed-path policy as photos)
        // — bypasses our server entirely so a 50-100MB file never has to
        // fit through a server action/API route body limit.
        const { error: uploadError } = await supabase.storage
          .from(VIDEO_BUCKET)
          .upload(path, file, { contentType: file.type });
        if (uploadError) throw new Error(`업로드 실패: ${uploadError.message}`);

        const result = await registerVideo({
          collaborationId,
          storagePath: path,
          originalFilename: file.name,
          mimeType: file.type,
          fileSizeBytes: file.size,
          durationSeconds: meta.duration,
          width: meta.width,
          height: meta.height,
        });
        if ("error" in result) throw new Error(result.error);
        localFilesRef.current.set(result.id, file);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "업로드에 실패했습니다.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // STEP39 item 6: analyzes only videos that don't already have
  // frame_analysis — re-running never re-spends credits on already-analyzed
  // clips, mirroring usePhotoManager's handleAnalyzeAll exactly.
  async function handleAnalyzeAll() {
    const targets = videos.filter((v) => !v.frame_analysis);
    if (targets.length === 0) return;
    setAnalyzing(true);
    setError(null);
    try {
      setAnalyzeProgress({ done: 0, total: targets.length });
      let done = 0;
      for (const video of targets) {
        const file = localFilesRef.current.get(video.id);
        if (!file) {
          // The local File is only available in the same browser session it
          // was picked in — after a refresh there's no local blob to re-seek
          // frames from. This is a known V1 limitation (see the STEP39
          // report item 35): re-analyzing after a reload isn't supported,
          // only analyzing right after upload in the same session is.
          done += 1;
          setAnalyzeProgress({ done, total: targets.length });
          continue;
        }
        const duration = video.duration_seconds ?? 0;
        const timestamps = [0, duration * 0.4, duration * 0.8].filter((t) => Number.isFinite(t));
        const frames = await extractFrames(file, duration, timestamps);
        const res = await fetch("/api/ai/analyze-video-frames", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ videoId: video.id, frames }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "영상 분석에 실패했습니다.");
        setVideos((prev) =>
          prev.map((v) =>
            v.id === video.id ? { ...v, frame_analysis: { frames: data.frames, summary: data.summary } } : v,
          ),
        );
        done += 1;
        setAnalyzeProgress({ done, total: targets.length });
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "영상 분석에 실패했습니다.");
      throw err;
    } finally {
      setAnalyzing(false);
      setAnalyzeProgress(null);
    }
  }

  async function handleDeleteVideo(video: VideoWithUrl) {
    setVideos((prev) => prev.filter((v) => v.id !== video.id));
    await deleteVideo(collaborationId, video.id, video.storage_path);
    router.refresh();
  }

  function handleMove(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= videos.length) return;
    setVideos((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      reorderVideos(collaborationId, next.map((v) => v.id));
      return next;
    });
  }

  return {
    videos,
    fileInputRef,
    uploading,
    analyzing,
    analyzeProgress,
    error,
    setError,
    handleAddVideos,
    handleAnalyzeAll,
    handleDeleteVideo,
    handleMove,
  };
}

export type VideoManager = ReturnType<typeof useVideoManager>;
