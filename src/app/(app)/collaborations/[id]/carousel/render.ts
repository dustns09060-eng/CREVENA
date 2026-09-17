"use client";

import type { CarouselCard, CarouselTemplate } from "./actions";
import type { PhotoWithUrl } from "../photos/usePhotoManager";

// STEP41: browser-only PNG rendering, same principle as STEP40's MP4
// rendering (client-side canvas, no AI call, no server compute, no third
// party). This module is intentionally self-contained rather than importing
// from ../reels/render.ts — that file backs STEP40/40-1's shipped MP4
// pipeline and is explicitly not to be touched for this STEP, and the two
// renderers need different canvas sizes (1080x1350/1080x1080 vs 1080x1920)
// and template-driven (not preset-driven) overlays, so sharing would mean
// generalizing render.ts's private helpers anyway.
export const ASPECT_SIZES: Record<"4:5" | "1:1", { width: number; height: number }> = {
  "4:5": { width: 1080, height: 1350 },
  "1:1": { width: 1080, height: 1080 },
};

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("사진을 불러오지 못했습니다."));
    img.src = src;
  });
}

function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number) {
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  if (!iw || !ih) return;
  const scale = Math.max(w / iw, h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

// Word-wraps into at most maxLines, breaking very long unspaced runs (long
// Korean compounds, URLs) at the character level too. Never shrinks the font
// to force a fit — instead truncates the last line with "…" once maxLines is
// reached, matching item 13's "안전한 최대 줄 수/overflow 처리" requirement
// (shrinking to illegibility is explicitly disallowed).
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  function pushCurrent() {
    if (current) lines.push(current);
    current = "";
  }

  outer: for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }
    // Current line is full — flush it, then see if the word itself fits.
    pushCurrent();
    if (lines.length >= maxLines) break outer;
    if (ctx.measureText(word).width <= maxWidth) {
      current = word;
      continue;
    }
    // The word alone is wider than the line — break it character by character.
    let chunk = "";
    for (const ch of word) {
      const next = chunk + ch;
      if (ctx.measureText(next).width > maxWidth && chunk) {
        lines.push(chunk);
        chunk = ch;
        if (lines.length >= maxLines) {
          chunk = "";
          break outer;
        }
      } else {
        chunk = next;
      }
    }
    current = chunk;
  }
  if (lines.length < maxLines) pushCurrent();

  const consumedWords = lines.join(" ").length + current.length;
  const hasOverflow = consumedWords < text.replace(/\s+/g, " ").length;
  if (lines.length >= maxLines && hasOverflow) {
    let last = lines[maxLines - 1] ?? "";
    while (last.length > 0 && ctx.measureText(`${last}…`).width > maxWidth) {
      last = last.slice(0, -1);
    }
    lines[maxLines - 1] = `${last}…`;
    return lines.slice(0, maxLines);
  }
  return lines;
}

type TemplateStyle = {
  overlay: "none" | "darkGradient" | "softGradient";
  panel: "none" | "solidWhite" | "translucentWhite";
  headlineColor: string;
  bodyColor: string;
  headlineWeight: string;
};

const TEMPLATE_STYLES: Record<CarouselTemplate, TemplateStyle> = {
  // Minimal: no panel box at all — the photo fills the whole card, a dark
  // gradient wash keeps white text legible. Closest to a plain IG aesthetic.
  minimal: { overlay: "darkGradient", panel: "none", headlineColor: "#ffffff", bodyColor: "#f4f4f5", headlineWeight: "700" },
  // Clean: an opaque white card panel under the text, dark text — a crisp
  // "magazine caption" look, clearly distinct from Minimal's overlay-on-photo.
  clean: { overlay: "none", panel: "solidWhite", headlineColor: "#18181b", bodyColor: "#3f3f46", headlineWeight: "700" },
  // Soft: a warm pastel gradient wash + a translucent (not fully opaque)
  // rounded panel — softer, warmer than Clean's crisp white card.
  soft: { overlay: "softGradient", panel: "translucentWhite", headlineColor: "#7c2d12", bodyColor: "#78350f", headlineWeight: "600" },
};

const HEADLINE_FONT_SIZE: Record<CarouselCard["headlineSize"], number> = { small: 44, medium: 56, large: 70 };
const BODY_FONT_SIZE_RATIO = 0.42;

function applyOverlay(ctx: CanvasRenderingContext2D, style: TemplateStyle, w: number, h: number) {
  if (style.overlay === "none") return;
  const grad = ctx.createLinearGradient(0, h * 0.45, 0, h);
  if (style.overlay === "darkGradient") {
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(0,0,0,0.62)");
  } else {
    grad.addColorStop(0, "rgba(255,214,170,0)");
    grad.addColorStop(1, "rgba(255,190,150,0.55)");
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, h * 0.45, w, h * 0.55);
}

export function renderCarouselCardToCanvas(params: {
  canvas: HTMLCanvasElement;
  img: HTMLImageElement;
  card: CarouselCard;
  template: CarouselTemplate;
  width: number;
  height: number;
}): void {
  const { canvas, img, card, template, width, height } = params;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("캔버스를 초기화하지 못했습니다.");

  ctx.clearRect(0, 0, width, height);
  drawCover(ctx, img, width, height);

  const style = TEMPLATE_STYLES[template];
  applyOverlay(ctx, style, width, height);

  const headlineSize = HEADLINE_FONT_SIZE[card.headlineSize];
  const bodySize = Math.round(headlineSize * BODY_FONT_SIZE_RATIO);
  const maxTextWidth = width * 0.86;
  const pad = width * 0.07;

  ctx.font = `${style.headlineWeight} ${headlineSize}px sans-serif`;
  const headlineLines = card.headline ? wrapText(ctx, card.headline, maxTextWidth, 2) : [];
  ctx.font = `500 ${bodySize}px sans-serif`;
  const bodyLines = card.body ? wrapText(ctx, card.body, maxTextWidth, 4) : [];

  const lineGapHeadline = headlineSize * 1.25;
  const lineGapBody = bodySize * 1.4;
  const textBlockGap = headlineLines.length > 0 && bodyLines.length > 0 ? headlineSize * 0.5 : 0;
  const textBlockHeight =
    headlineLines.length * lineGapHeadline + textBlockGap + bodyLines.length * lineGapBody;

  const panelPadY = width * 0.06;
  const panelHeight = style.panel === "none" ? 0 : textBlockHeight + panelPadY * 2;

  let blockTop: number;
  if (card.textPosition === "top") blockTop = height * 0.08;
  else if (card.textPosition === "middle") blockTop = height / 2 - (panelHeight || textBlockHeight) / 2;
  else blockTop = height * 0.92 - (panelHeight || textBlockHeight);

  if (style.panel !== "none") {
    ctx.fillStyle = style.panel === "solidWhite" ? "rgba(255,255,255,0.96)" : "rgba(255,255,255,0.8)";
    ctx.beginPath();
    ctx.roundRect(pad * 0.6, blockTop, width - pad * 1.2, panelHeight, 20);
    ctx.fill();
  }

  const textTop = blockTop + panelPadY;
  ctx.textBaseline = "top";
  ctx.textAlign = card.textAlign;
  const textX = card.textAlign === "left" ? pad : card.textAlign === "right" ? width - pad : width / 2;

  let y = textTop;
  ctx.font = `${style.headlineWeight} ${headlineSize}px sans-serif`;
  ctx.fillStyle = style.headlineColor;
  for (const line of headlineLines) {
    ctx.fillText(line, textX, y, maxTextWidth);
    y += lineGapHeadline;
  }
  y += textBlockGap;
  ctx.font = `500 ${bodySize}px sans-serif`;
  ctx.fillStyle = style.bodyColor;
  for (const line of bodyLines) {
    ctx.fillText(line, textX, y, maxTextWidth);
    y += lineGapBody;
  }
}

export async function renderCarouselCardToPngBlob(params: {
  card: CarouselCard;
  photo: PhotoWithUrl;
  template: CarouselTemplate;
  aspectRatio: "4:5" | "1:1";
}): Promise<Blob> {
  const { card, photo, template, aspectRatio } = params;
  const { width, height } = ASPECT_SIZES[aspectRatio];
  const img = await loadImage(photo.fullUrl);
  const canvas = document.createElement("canvas");
  renderCarouselCardToCanvas({ canvas, img, card, template, width, height });
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error("PNG 생성에 실패했습니다."));
      else resolve(blob);
    }, "image/png");
  });
}
