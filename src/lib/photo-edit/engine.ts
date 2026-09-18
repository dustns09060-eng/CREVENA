import type { HslBand, PhotoAdjustments, ToneCurvePoint } from "./types";

// STEP43.5: the actual pixel-processing engine. Runs on a canvas 2D
// ImageData buffer — no AI, no server, no third-party image API. This is a
// reasonable visual approximation of the Adobe Camera Raw pipeline, not a
// bit-exact reproduction (Lightroom operates on raw sensor data in a wide
// scene-referred color space; this operates on already-encoded sRGB JPEG
// pixels). See STEP43.5 report item 19 for a fuller explanation of where
// and why results can differ from Lightroom.
//
// CRITICAL invariant (STEP43.5 rule "절대 누적 보정 금지"): callers must
// always pass pixel data derived from the ORIGINAL photo, never from a
// previously-edited result. `intensity` (0..1) blends "no effect at all"
// toward "the full preset", it never composes two edits.

const HSL_BAND_CENTERS: { band: HslBand; hueDeg: number }[] = [
  { band: "red", hueDeg: 0 },
  { band: "orange", hueDeg: 30 },
  { band: "yellow", hueDeg: 60 },
  { band: "green", hueDeg: 120 },
  { band: "aqua", hueDeg: 180 },
  { band: "blue", hueDeg: 240 },
  { band: "purple", hueDeg: 275 },
  { band: "magenta", hueDeg: 315 },
];

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
function clamp255(v: number) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255,
    gn = g / 255,
    bn = b / 255;
  const max = Math.max(rn, gn, bn),
    min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h = h * 60;
  if (h < 0) h += 360;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [clamp255((r + m) * 255), clamp255((g + m) * 255), clamp255((b + m) * 255)];
}

function hueDelta(a: number, b: number) {
  let d = Math.abs(a - b);
  if (d > 180) d = 360 - d;
  return d;
}

// Interpolates a tone curve at 256 points (piecewise-linear between control
// points — matches the "point curve" shape closely enough for preview/apply
// without needing a full spline implementation).
function buildCurveLut(points: ToneCurvePoint[] | undefined): number[] | null {
  if (!points || points.length < 2) return null;
  const sorted = [...points].sort((a, b) => a[0] - b[0]);
  const lut = new Array<number>(256);
  for (let x = 0; x < 256; x++) {
    let i = 0;
    while (i < sorted.length - 1 && sorted[i + 1][0] < x) i++;
    const [x0, y0] = sorted[Math.min(i, sorted.length - 1)];
    const [x1, y1] = sorted[Math.min(i + 1, sorted.length - 1)];
    if (x1 === x0) {
      lut[x] = y0;
    } else {
      const t = (x - x0) / (x1 - x0);
      lut[x] = y0 + (y1 - y0) * t;
    }
  }
  return lut;
}

// Builds a single 256-entry LUT combining exposure/contrast/highlights/
// shadows/whites/blacks into one tonal transform, scaled by `intensity`.
// Applied identically to R, G, B (a standard simplification for a
// non-raw web pipeline — see report item 19).
function buildToneLut(a: PhotoAdjustments, intensity: number): number[] {
  const exposure = (a.exposure ?? 0) * intensity;
  const contrast = ((a.contrast ?? 0) / 100) * intensity;
  const highlights = ((a.highlights ?? 0) / 100) * intensity;
  const shadows = ((a.shadows ?? 0) / 100) * intensity;
  const whites = ((a.whites ?? 0) / 100) * intensity;
  const blacks = ((a.blacks ?? 0) / 100) * intensity;

  const lut = new Array<number>(256);
  for (let v = 0; v < 256; v++) {
    let x = v / 255;

    // Exposure: multiplicative gain in a gamma-approximated linear space,
    // closer to a real exposure stop than a flat brightness add.
    x = Math.pow(x, 1) * Math.pow(2, exposure);

    // Shadows/Highlights: region-weighted lift, using smooth weights so the
    // two regions don't create a hard seam at midtone.
    const shadowWeight = Math.pow(1 - x, 2);
    const highlightWeight = Math.pow(x, 2);
    x += shadows * 0.5 * shadowWeight;
    x += highlights * 0.5 * highlightWeight;

    // Whites/Blacks: push the extreme ends of the range.
    x += whites * 0.3 * highlightWeight;
    x -= -blacks * 0.3 * shadowWeight; // blacks<0 darkens shadows further

    // Contrast: simple S-curve around mid-gray.
    x = 0.5 + (x - 0.5) * (1 + contrast);

    lut[v] = clamp255(clamp01(x) * 255);
  }
  return lut;
}

function vignetteFactor(
  nx: number,
  ny: number,
  amount: number,
  midpoint: number,
  feather: number,
  roundness: number,
  intensity: number,
): number {
  const aspectAdjust = 1 + roundness / 200;
  const dx = nx * aspectAdjust;
  const dy = ny;
  const dist = Math.sqrt(dx * dx + dy * dy) / Math.SQRT2;
  const mid = midpoint / 100;
  const feath = Math.max(0.01, feather / 100);
  const t = clamp01((dist - mid) / feath);
  const falloff = t * t * (3 - 2 * t); // smoothstep
  return 1 + (amount / 100) * falloff * intensity;
}

export interface ApplyOptions {
  onProgress?: (done: number, total: number) => void;
  /** Yield back to the event loop every N rows so a large image never freezes the tab. */
  yieldEveryRows?: number;
}

// Applies `adjustments` at `intensity` (0..1) to `source` (which MUST be
// derived from the untouched original photo) and returns a new ImageData.
// Async so it can yield between row-chunks on large images.
export async function applyPhotoAdjustments(
  source: ImageData,
  adjustments: PhotoAdjustments,
  intensity: number,
  options: ApplyOptions = {},
): Promise<ImageData> {
  const { width, height, data } = source;
  const out = new Uint8ClampedArray(data); // always a fresh copy of the ORIGINAL pixels
  const clampedIntensity = clamp01(intensity);

  if (clampedIntensity <= 0) {
    return new ImageData(out, width, height);
  }

  const toneLut = buildToneLut(adjustments, clampedIntensity);
  const curveRgb = buildCurveLut(adjustments.toneCurve?.rgb);
  const curveR = buildCurveLut(adjustments.toneCurve?.red);
  const curveG = buildCurveLut(adjustments.toneCurve?.green);
  const curveB = buildCurveLut(adjustments.toneCurve?.blue);
  const curveIntensity = clampedIntensity;

  const temperature = ((adjustments.temperature ?? 0) / 100) * clampedIntensity;
  const tint = ((adjustments.tint ?? 0) / 100) * clampedIntensity;
  const vibrance = ((adjustments.vibrance ?? 0) / 100) * clampedIntensity;
  const saturationAdj = ((adjustments.saturation ?? 0) / 100) * clampedIntensity;
  const clarity = ((adjustments.clarity ?? 0) / 100) * clampedIntensity;
  const texture = ((adjustments.texture ?? 0) / 100) * clampedIntensity;
  const dehaze = ((adjustments.dehaze ?? 0) / 100) * clampedIntensity;

  const hsl = adjustments.hsl;
  const colorGrade = adjustments.colorGrade;
  const vignette = adjustments.vignette;
  const grain = adjustments.grain;

  const yieldEveryRows = options.yieldEveryRows ?? 64;
  const cx = width / 2;
  const cy = height / 2;
  const maxDist = Math.max(cx, cy);

  for (let y = 0; y < height; y++) {
    const rowStart = y * width * 4;
    for (let x = 0; x < width; x++) {
      const i = rowStart + x * 4;
      let r = out[i];
      let g = out[i + 1];
      let b = out[i + 2];

      // 1) Tonal LUT (exposure/contrast/highlights/shadows/whites/blacks)
      r = toneLut[r];
      g = toneLut[g];
      b = toneLut[b];

      // 2) Tone curve (combined RGB, then per-channel)
      if (curveRgb) {
        r = clamp255(r + (curveRgb[Math.round(r)] - r) * curveIntensity);
        g = clamp255(g + (curveRgb[Math.round(g)] - g) * curveIntensity);
        b = clamp255(b + (curveRgb[Math.round(b)] - b) * curveIntensity);
      }
      if (curveR) r = clamp255(r + (curveR[Math.round(r)] - r) * curveIntensity);
      if (curveG) g = clamp255(g + (curveG[Math.round(g)] - g) * curveIntensity);
      if (curveB) b = clamp255(b + (curveB[Math.round(b)] - b) * curveIntensity);

      // 3) Temperature / Tint — simple channel-gain approximation of white balance.
      if (temperature !== 0 || tint !== 0) {
        r = clamp255(r + temperature * 40 - tint * 10);
        g = clamp255(g + tint * 30);
        b = clamp255(b - temperature * 40 - tint * 10);
      }

      // 4) Coarse local-contrast approximations (clarity/texture/dehaze):
      // a midtone-weighted S-curve nudge, not a true spatial unsharp mask.
      if (clarity !== 0 || texture !== 0 || dehaze !== 0) {
        const localBoost = (clarity * 0.5 + texture * 0.3 + dehaze * 0.4) * 0.35;
        const luma = (r + g + b) / 3 / 255;
        const weight = 1 - Math.abs(luma - 0.5) * 2;
        const factor = 1 + localBoost * weight;
        r = clamp255(128 + (r - 128) * factor);
        g = clamp255(128 + (g - 128) * factor);
        b = clamp255(128 + (b - 128) * factor);
        if (dehaze !== 0) {
          const dehazeLift = dehaze * -20;
          r = clamp255(r + dehazeLift * (1 - luma));
          g = clamp255(g + dehazeLift * (1 - luma));
          b = clamp255(b + dehazeLift * (1 - luma));
        }
      }

      // 5) HSL: convert once, apply vibrance/saturation + per-band + color grading.
      if (
        vibrance !== 0 ||
        saturationAdj !== 0 ||
        hsl ||
        colorGrade
      ) {
        let [h, s, l] = rgbToHsl(r, g, b);

        if (vibrance !== 0) {
          s = clamp01(s + vibrance * (1 - s) * 0.8);
        }
        if (saturationAdj !== 0) {
          s = clamp01(s * (1 + saturationAdj));
        }

        if (hsl) {
          for (const { band, hueDeg } of HSL_BAND_CENTERS) {
            const adj = hsl[band];
            if (!adj) continue;
            const d = hueDelta(h, hueDeg);
            if (d > 45) continue;
            const weight = 1 - d / 45;
            h = (h + (adj.hue / 100) * 20 * weight + 360) % 360;
            s = clamp01(s + (adj.saturation / 100) * weight * clampedIntensity);
            l = clamp01(l + (adj.luminance / 100) * 0.3 * weight * clampedIntensity);
          }
        }

        [r, g, b] = hslToRgb(h, s, l);

        if (colorGrade) {
          const luma = (r + g + b) / 3 / 255;
          const shadowW = Math.pow(1 - luma, 2);
          const highlightW = Math.pow(luma, 2);
          const midW = Math.max(0, 1 - shadowW - highlightW);
          const blend = (colorGrade.blending ?? 50) / 100;
          const zones: [typeof colorGrade.shadow, number][] = [
            [colorGrade.shadow, shadowW],
            [colorGrade.midtone, midW],
            [colorGrade.highlight, highlightW],
            [colorGrade.global, 1],
          ];
          for (const [zone, weight] of zones) {
            if (!zone) continue;
            const effWeight = weight * blend * clampedIntensity;
            if (zone.saturation !== 0 && effWeight > 0) {
              const [zr, zg, zb] = hslToRgb(zone.hue, clamp01(zone.saturation / 100), 0.5);
              r = clamp255(r + (zr - r) * effWeight * 0.25);
              g = clamp255(g + (zg - g) * effWeight * 0.25);
              b = clamp255(b + (zb - b) * effWeight * 0.25);
            }
            if (zone.luminance !== 0) {
              const lift = (zone.luminance / 100) * weight * clampedIntensity * 25;
              r = clamp255(r + lift);
              g = clamp255(g + lift);
              b = clamp255(b + lift);
            }
          }
        }
      }

      // 6) Vignette
      if (vignette && vignette.amount !== 0) {
        const nx = (x - cx) / maxDist;
        const ny = (y - cy) / maxDist;
        const factor = vignetteFactor(
          nx,
          ny,
          vignette.amount,
          vignette.midpoint,
          vignette.feather,
          vignette.roundness,
          clampedIntensity,
        );
        r = clamp255(r * factor);
        g = clamp255(g * factor);
        b = clamp255(b * factor);
      }

      // 7) Grain
      if (grain && grain.amount !== 0) {
        const noiseScale = (grain.amount / 100) * clampedIntensity * 18;
        const noise = (Math.random() - 0.5) * noiseScale;
        r = clamp255(r + noise);
        g = clamp255(g + noise);
        b = clamp255(b + noise);
      }

      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      // alpha (out[i+3]) untouched
    }

    if (yieldEveryRows > 0 && y % yieldEveryRows === 0) {
      options.onProgress?.(y, height);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  options.onProgress?.(height, height);
  return new ImageData(out, width, height);
}
