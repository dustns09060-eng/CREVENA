"use client";

import { Output, Mp4OutputFormat, BufferTarget, CanvasSource, Quality, canEncodeVideo } from "mediabunny";
import type { ReelsScene, ReelsCaptionStyle } from "./actions";
import type { VideoWithUrl } from "./useVideoManager";

// STEP40: browser-only MP4 rendering — see the STEP40 report for the full
// architecture writeup (why client-side WebCodecs+Mediabunny was chosen over
// server FFmpeg/external APIs). No audio track in V1 (see report item 23) —
// output is always silent, matching the video-only WebCodecs support that
// exists on a much wider range of browsers/iOS Safari versions than full
// (audio-inclusive) WebCodecs. No font file is bundled — captions use the
// browser/OS's own "sans-serif" system font, so there is nothing to license
// or redistribute.
export const OUTPUT_WIDTH = 1080;
export const OUTPUT_HEIGHT = 1920;
const RENDER_FPS = 12;

// Only the full-size URL is needed to render; collaboration photos and
// Product Shorts media both satisfy this shape.
export type RenderablePhoto = { fullUrl: string };

export type RenderProgress = {
  sceneIndex: number;
  totalScenes: number;
  stage: "preparing" | "rendering" | "finalizing";
};

export async function checkMp4RenderSupport(): Promise<boolean> {
  try {
    return await canEncodeVideo("avc", { width: OUTPUT_WIDTH, height: OUTPUT_HEIGHT });
  } catch {
    return false;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("사진을 불러오지 못했습니다."));
    img.src = src;
  });
}

function loadVideo(src: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.crossOrigin = "anonymous";
    v.muted = true;
    v.preload = "auto";
    v.onloadeddata = () => resolve(v);
    v.onerror = () => reject(new Error("영상을 불러오지 못했습니다."));
    v.src = src;
  });
}

function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      resolve();
    };
    video.addEventListener("seeked", onSeeked);
    video.onerror = () => reject(new Error("영상 탐색에 실패했습니다."));
    video.currentTime = time;
  });
}

const CAPTION_BG: Record<ReelsCaptionStyle["preset"], string> = {
  basic: "rgba(0,0,0,0.65)",
  clean: "rgba(255,255,255,0.92)",
  emphasis: "#facc15",
};
const CAPTION_FG: Record<ReelsCaptionStyle["preset"], string> = {
  basic: "#ffffff",
  clean: "#18181b",
  emphasis: "#000000",
};
const CAPTION_WEIGHT: Record<ReelsCaptionStyle["preset"], string> = {
  basic: "600",
  clean: "600",
  emphasis: "800",
};
const CAPTION_FONT_SIZE: Record<ReelsCaptionStyle["size"], number> = {
  small: 34,
  medium: 46,
  large: 62,
};

function drawCover(ctx: CanvasRenderingContext2D, media: HTMLImageElement | HTMLVideoElement, iw: number, ih: number) {
  if (!iw || !ih) return;
  const scale = Math.max(OUTPUT_WIDTH / iw, OUTPUT_HEIGHT / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.drawImage(media, (OUTPUT_WIDTH - dw) / 2, (OUTPUT_HEIGHT - dh) / 2, dw, dh);
}

// Mirrors the 9:16 preview's caption box as closely as reasonably possible
// (same preset colors/position/size classes as ReelsStudio.tsx) so what the
// user saw in-app matches what ends up burned into the MP4.
function drawCaption(ctx: CanvasRenderingContext2D, text: string, style: ReelsCaptionStyle) {
  if (!text) return;
  const fontSize = CAPTION_FONT_SIZE[style.size];
  ctx.font = `${CAPTION_WEIGHT[style.preset]} ${fontSize}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const maxWidth = OUTPUT_WIDTH * 0.86;
  const metrics = ctx.measureText(text);
  const textWidth = Math.min(metrics.width, maxWidth);
  const padX = fontSize * 0.5;
  const padY = fontSize * 0.35;
  const boxW = textWidth + padX * 2;
  const boxH = fontSize + padY * 2;

  let boxY: number;
  if (style.position === "top") boxY = OUTPUT_HEIGHT * 0.1;
  else if (style.position === "middle") boxY = OUTPUT_HEIGHT / 2 - boxH / 2;
  else boxY = OUTPUT_HEIGHT * 0.82 - boxH;

  const boxX = OUTPUT_WIDTH / 2 - boxW / 2;
  ctx.fillStyle = CAPTION_BG[style.preset];
  const radius = 12;
  ctx.beginPath();
  ctx.roundRect(boxX, boxY, boxW, boxH, radius);
  ctx.fill();

  ctx.fillStyle = CAPTION_FG[style.preset];
  ctx.fillText(text, OUTPUT_WIDTH / 2, boxY + boxH / 2, maxWidth);
}

export async function renderReelsToMp4(params: {
  scenes: ReelsScene[];
  photoById: Map<string, RenderablePhoto>;
  videoById: Map<string, VideoWithUrl>;
  captionStyle: ReelsCaptionStyle;
  onProgress?: (p: RenderProgress) => void;
}): Promise<Blob> {
  const { scenes, photoById, videoById, captionStyle, onProgress } = params;
  if (scenes.length === 0) throw new Error("포함된 장면이 없습니다.");

  const supported = await checkMp4RenderSupport();
  if (!supported) {
    throw new Error(
      "이 브라우저에서는 MP4 렌더링(H.264 인코딩)을 지원하지 않습니다. 최신 Chrome, Edge, 또는 최신 Safari에서 다시 시도해주세요.",
    );
  }

  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_WIDTH;
  canvas.height = OUTPUT_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("캔버스를 초기화하지 못했습니다.");

  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
  const videoSource = new CanvasSource(canvas, { codec: "avc", quality: new Quality("medium") });
  output.addVideoTrack(videoSource);
  await output.start();

  let timelineSeconds = 0;

  try {
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      onProgress?.({ sceneIndex: i, totalScenes: scenes.length, stage: "preparing" });

      if (scene.mediaType === "photo") {
        const photo = photoById.get(scene.mediaId);
        if (!photo) throw new Error(`사진을 찾을 수 없습니다 (장면 ${i + 1}).`);
        const img = await loadImage(photo.fullUrl);
        ctx.clearRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);
        drawCover(ctx, img, img.naturalWidth, img.naturalHeight);
        if (scene.captionVisible) drawCaption(ctx, scene.caption, captionStyle);
        onProgress?.({ sceneIndex: i, totalScenes: scenes.length, stage: "rendering" });
        await videoSource.add(timelineSeconds, scene.durationSeconds);
        timelineSeconds += scene.durationSeconds;
      } else {
        const video = videoById.get(scene.mediaId);
        if (!video) throw new Error(`영상을 찾을 수 없습니다 (장면 ${i + 1}).`);
        const videoEl = await loadVideo(video.url);
        onProgress?.({ sceneIndex: i, totalScenes: scenes.length, stage: "rendering" });

        const trimStart = scene.trimStart ?? 0;
        const trimEnd = scene.trimEnd ?? Math.min(video.duration_seconds ?? scene.durationSeconds, scene.durationSeconds);
        const sourceSpan = Math.max(0.1, trimEnd - trimStart);
        const frameCount = Math.max(1, Math.round(scene.durationSeconds * RENDER_FPS));
        const frameDuration = scene.durationSeconds / frameCount;

        for (let f = 0; f < frameCount; f++) {
          const progressRatio = frameCount > 1 ? f / (frameCount - 1) : 0;
          const sourceTime = Math.min(trimStart + progressRatio * sourceSpan, Math.max(trimEnd - 0.05, trimStart));
          await seekVideo(videoEl, sourceTime);
          ctx.clearRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);
          drawCover(ctx, videoEl, videoEl.videoWidth, videoEl.videoHeight);
          if (scene.captionVisible) drawCaption(ctx, scene.caption, captionStyle);
          await videoSource.add(timelineSeconds, frameDuration);
          timelineSeconds += frameDuration;
        }
      }
    }

    onProgress?.({ sceneIndex: scenes.length, totalScenes: scenes.length, stage: "finalizing" });
    await output.finalize();
  } catch (err) {
    await output.cancel().catch(() => {});
    throw err;
  }

  const buffer = output.target.buffer;
  if (!buffer) throw new Error("렌더링 결과를 가져오지 못했습니다.");
  return new Blob([buffer], { type: "video/mp4" });
}
