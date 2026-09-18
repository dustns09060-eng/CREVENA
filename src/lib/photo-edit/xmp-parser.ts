import type {
  ColorGradeZone,
  HslAdjustment,
  HslBand,
  PhotoAdjustments,
  ToneCurvePoint,
  XmpParseResult,
  XmpParseWarning,
} from "./types";

// STEP43.5: parses a real Adobe Camera Raw / Lightroom .xmp preset file into
// a PhotoAdjustments object CREVENA can actually render. Grounded in 10 real
// user-provided preset files (EP01–EP10, "뉴에피소드 시즌1") rather than
// guessed attribute names — every crs: attribute referenced below was
// confirmed present in at least one of those files.
//
// Security: uses the browser's DOMParser in "application/xml" mode only.
// DOMParser never fetches external entities, never executes <script>, and
// never resolves remote DTDs — the XMP is treated purely as inert data.
// We additionally never use regex-only parsing of the whole document (only
// small, already-namespace-resolved attribute/text values are read).

// Real preset files in this project's test set are 2–4.4KB. A full Camera
// Raw "develop settings" (not a preset) with masks/curves can run larger,
// but still nowhere near this limit — 512KB is a >100x safety margin over
// anything a legitimate preset produces, while still rejecting pathological
// or corrupted uploads before they're ever parsed.
export const MAX_XMP_FILE_SIZE_BYTES = 512 * 1024;

const HSL_BAND_KEYS: { xmp: string; band: HslBand }[] = [
  { xmp: "Red", band: "red" },
  { xmp: "Orange", band: "orange" },
  { xmp: "Yellow", band: "yellow" },
  { xmp: "Green", band: "green" },
  { xmp: "Aqua", band: "aqua" },
  { xmp: "Blue", band: "blue" },
  { xmp: "Purple", band: "purple" },
  { xmp: "Magenta", band: "magenta" },
];

function findDescriptionElement(doc: Document): Element | null {
  const byNs = doc.getElementsByTagNameNS("http://www.w3.org/1999/02/22-rdf-syntax-ns#", "Description");
  if (byNs.length > 0) return byNs[0];
  const byName = doc.getElementsByTagName("rdf:Description");
  if (byName.length > 0) return byName[0];
  // Last resort: any element whose local name is Description.
  const all = doc.getElementsByTagName("*");
  for (let i = 0; i < all.length; i++) {
    if (all[i].localName === "Description") return all[i];
  }
  return null;
}

function attr(desc: Element, name: string): string | null {
  return desc.getAttribute(`crs:${name}`) ?? desc.getAttribute(name);
}

function numAttr(desc: Element, name: string): number | null {
  const raw = attr(desc, name);
  if (raw === null || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function findChildByLocalName(root: Element, localName: string): Element | null {
  const list = root.getElementsByTagNameNS("*", localName);
  if (list.length > 0) return list[0];
  const all = root.getElementsByTagName("*");
  for (let i = 0; i < all.length; i++) {
    if (all[i].localName === localName) return all[i];
  }
  return null;
}

function readCurvePoints(root: Element, elementLocalName: string): ToneCurvePoint[] | null {
  const curveEl = findChildByLocalName(root, elementLocalName);
  if (!curveEl) return null;
  const items = curveEl.getElementsByTagName("*");
  const points: ToneCurvePoint[] = [];
  for (let i = 0; i < items.length; i++) {
    if (items[i].localName !== "li") continue;
    const text = items[i].textContent?.trim() ?? "";
    const parts = text.split(",").map((p) => Number(p.trim()));
    if (parts.length === 2 && parts.every((n) => Number.isFinite(n))) {
      points.push([parts[0], parts[1]]);
    }
  }
  return points.length >= 2 ? points : null;
}

function readPresetName(desc: Element, fallback: string): string {
  // <crs:Name><rdf:Alt><rdf:li xml:lang="x-default">Actual Name</rdf:li></rdf:Alt></crs:Name>
  const nameEl = findChildByLocalName(desc, "Name");
  if (nameEl) {
    const li = nameEl.getElementsByTagName("*");
    for (let i = 0; i < li.length; i++) {
      if (li[i].localName === "li") {
        const text = li[i].textContent?.trim();
        if (text) return text;
      }
    }
  }
  return fallback;
}

function nonZero(...values: (number | null | undefined)[]): boolean {
  return values.some((v) => typeof v === "number" && v !== 0);
}

export function parseXmpPreset(xmlText: string, filename: string): XmpParseResult {
  const fallbackName = filename.replace(/\.xmp$/i, "");

  if (!xmlText || xmlText.trim().length === 0) {
    return emptyFailure(fallbackName, "빈 파일이에요. 다른 XMP 파일을 선택해주세요.");
  }

  let doc: Document;
  try {
    const parser = new DOMParser();
    doc = parser.parseFromString(xmlText, "application/xml");
  } catch {
    return emptyFailure(fallbackName, "지원되는 XMP 프리셋 파일이 아니에요.");
  }

  const parserError = doc.getElementsByTagName("parsererror")[0];
  if (parserError) {
    return emptyFailure(fallbackName, "지원되는 XMP 프리셋 파일이 아니에요.");
  }

  const desc = findDescriptionElement(doc);
  if (!desc) {
    return emptyFailure(fallbackName, "지원되는 XMP 프리셋 파일이 아니에요.");
  }

  const hasCrsNamespace =
    desc.getAttribute("xmlns:crs") === "http://ns.adobe.com/camera-raw-settings/1.0/" ||
    doc.documentElement.getAttribute("xmlns:x") === "adobe:ns:meta/" ||
    attr(desc, "HasSettings") !== null;
  if (!hasCrsNamespace) {
    return emptyFailure(fallbackName, "지원되는 XMP 프리셋 파일이 아니에요.");
  }

  const supported: string[] = [];
  const unsupported: string[] = [];
  const warnings: XmpParseWarning[] = [];
  const adjustments: PhotoAdjustments = {};

  // --- Tonal controls ---------------------------------------------------
  const exposure = numAttr(desc, "Exposure2012");
  const contrast = numAttr(desc, "Contrast2012");
  const highlights = numAttr(desc, "Highlights2012");
  const shadows = numAttr(desc, "Shadows2012");
  const whites = numAttr(desc, "Whites2012");
  const blacks = numAttr(desc, "Blacks2012");
  if (nonZero(exposure)) supported.push("노출(Exposure)");
  if (nonZero(contrast)) supported.push("대비(Contrast)");
  if (nonZero(highlights)) supported.push("밝은 영역(Highlights)");
  if (nonZero(shadows)) supported.push("어두운 영역(Shadows)");
  if (nonZero(whites)) supported.push("화이트(Whites)");
  if (nonZero(blacks)) supported.push("블랙(Blacks)");
  if (exposure) adjustments.exposure = exposure;
  if (contrast) adjustments.contrast = contrast;
  if (highlights) adjustments.highlights = highlights;
  if (shadows) adjustments.shadows = shadows;
  if (whites) adjustments.whites = whites;
  if (blacks) adjustments.blacks = blacks;

  // --- Temperature / Tint (relative "incremental" shift, preset-style) --
  const whiteBalance = attr(desc, "WhiteBalance");
  const temperature = numAttr(desc, "IncrementalTemperature");
  const tint = numAttr(desc, "IncrementalTint");
  if (whiteBalance === "Custom" && nonZero(temperature, tint)) {
    supported.push("색온도/색조(Temperature/Tint)");
    if (temperature) adjustments.temperature = temperature;
    if (tint) adjustments.tint = tint;
  } else if (whiteBalance && whiteBalance !== "Custom" && whiteBalance !== "As Shot") {
    warnings.push({
      code: "white_balance_named",
      message: "이 프리셋은 카메라 화이트밸런스 프리셋(예: 태양광, 그늘)을 기준으로 만들어져 웹에서는 다르게 보일 수 있어요.",
    });
  }

  // --- Vibrance / Saturation ---------------------------------------------
  const vibrance = numAttr(desc, "Vibrance");
  const saturation = numAttr(desc, "Saturation");
  if (nonZero(vibrance)) supported.push("생동감(Vibrance)");
  if (nonZero(saturation)) supported.push("채도(Saturation)");
  if (vibrance) adjustments.vibrance = vibrance;
  if (saturation) adjustments.saturation = saturation;

  // --- Clarity / Texture / Dehaze (coarse approximations) ----------------
  const clarity = numAttr(desc, "Clarity2012") ?? numAttr(desc, "Clarity");
  const texture = numAttr(desc, "Texture");
  const dehaze = numAttr(desc, "Dehaze");
  if (nonZero(clarity)) supported.push("선명도(Clarity, 근사치)");
  if (nonZero(texture)) supported.push("텍스처(Texture, 근사치)");
  if (nonZero(dehaze)) supported.push("안개 제거(Dehaze, 근사치)");
  if (clarity) adjustments.clarity = clarity;
  if (texture) adjustments.texture = texture;
  if (dehaze) adjustments.dehaze = dehaze;

  // --- HSL (per-color Hue/Saturation/Luminance) ---------------------------
  const hsl: Partial<Record<HslBand, HslAdjustment>> = {};
  let hslHasAny = false;
  for (const { xmp, band } of HSL_BAND_KEYS) {
    const h = numAttr(desc, `HueAdjustment${xmp}`) ?? 0;
    const s = numAttr(desc, `SaturationAdjustment${xmp}`) ?? 0;
    const l = numAttr(desc, `LuminanceAdjustment${xmp}`) ?? 0;
    if (nonZero(h, s, l)) {
      hsl[band] = { hue: h, saturation: s, luminance: l };
      hslHasAny = true;
    }
  }
  if (hslHasAny) {
    supported.push("색상별 보정(HSL)");
    adjustments.hsl = hsl;
  }

  // --- Tone Curve (point-based) -------------------------------------------
  const curveRgb = readCurvePoints(desc, "ToneCurvePV2012");
  const curveRed = readCurvePoints(desc, "ToneCurvePV2012Red");
  const curveGreen = readCurvePoints(desc, "ToneCurvePV2012Green");
  const curveBlue = readCurvePoints(desc, "ToneCurvePV2012Blue");
  const isIdentity = (pts: ToneCurvePoint[] | null) =>
    !pts || (pts.length === 2 && pts[0][0] === 0 && pts[0][1] === 0 && pts[1][0] === 255 && pts[1][1] === 255);
  if (!isIdentity(curveRgb) || !isIdentity(curveRed) || !isIdentity(curveGreen) || !isIdentity(curveBlue)) {
    supported.push("톤 커브(Tone Curve)");
    adjustments.toneCurve = {
      rgb: curveRgb ?? undefined,
      red: curveRed ?? undefined,
      green: curveGreen ?? undefined,
      blue: curveBlue ?? undefined,
    };
  } else {
    const curveName = attr(desc, "ToneCurveName2012");
    if (curveName && curveName !== "Linear" && !curveRgb) {
      unsupported.push(`톤 커브 프리셋(${curveName})`);
      warnings.push({
        code: "tone_curve_named_only",
        message: "이 프리셋의 톤 커브는 이름만 저장되어 있어 CREVENA에서 그대로 재현할 수 없어요.",
      });
    }
  }

  // --- Color Grading (3-way) ----------------------------------------------
  function readZone(descEl: Element, prefix: string): ColorGradeZone | null {
    const h = numAttr(descEl, `ColorGrade${prefix}Hue`) ?? 0;
    const s = numAttr(descEl, `ColorGrade${prefix}Sat`) ?? 0;
    const l = numAttr(descEl, `ColorGrade${prefix}Lum`) ?? 0;
    return nonZero(h, s, l) ? { hue: h, saturation: s, luminance: l } : null;
  }
  const cgShadow = readZone(desc, "Shadow");
  const cgMidtone = readZone(desc, "Midtone");
  const cgHighlight = readZone(desc, "Highlight");
  const cgGlobal = readZone(desc, "Global");
  const cgBlending = numAttr(desc, "ColorGradeBlending");
  if (cgShadow || cgMidtone || cgHighlight || cgGlobal) {
    supported.push("컬러 그레이딩(Color Grading)");
    adjustments.colorGrade = {
      shadow: cgShadow ?? undefined,
      midtone: cgMidtone ?? undefined,
      highlight: cgHighlight ?? undefined,
      global: cgGlobal ?? undefined,
      blending: cgBlending ?? undefined,
    };
  }

  // --- Vignette (post-crop) -----------------------------------------------
  const vigAmount = numAttr(desc, "PostCropVignetteAmount");
  if (nonZero(vigAmount)) {
    supported.push("비네트(Vignette)");
    adjustments.vignette = {
      amount: vigAmount!,
      midpoint: numAttr(desc, "PostCropVignetteMidpoint") ?? 50,
      feather: numAttr(desc, "PostCropVignetteFeather") ?? 50,
      roundness: numAttr(desc, "PostCropVignetteRoundness") ?? 0,
    };
    const style = attr(desc, "PostCropVignetteStyle");
    if (style && style !== "0") {
      warnings.push({
        code: "vignette_style",
        message: "비네트의 세부 스타일(하이라이트 우선 등)은 CREVENA에서 단순화되어 표현돼요.",
      });
    }
  }

  // --- Grain ----------------------------------------------------------------
  const grainAmount = numAttr(desc, "GrainAmount");
  if (nonZero(grainAmount)) {
    supported.push("그레인(Grain)");
    adjustments.grain = {
      amount: grainAmount!,
      size: numAttr(desc, "GrainSize") ?? 25,
      frequency: numAttr(desc, "GrainFrequency") ?? 50,
    };
  }

  // --- Known-unsupported visual features (reported, never fatal) ----------
  const calibrationTouched = nonZero(
    numAttr(desc, "RedHue"),
    numAttr(desc, "RedSaturation"),
    numAttr(desc, "GreenHue"),
    numAttr(desc, "GreenSaturation"),
    numAttr(desc, "BlueHue"),
    numAttr(desc, "BlueSaturation"),
    numAttr(desc, "ShadowTint"),
  );
  if (calibrationTouched) unsupported.push("카메라 캘리브레이션(Camera Calibration)");

  const sharpeningTouched = nonZero(
    numAttr(desc, "SharpenDetail"),
    numAttr(desc, "SharpenEdgeMasking"),
    numAttr(desc, "SharpenRadius"),
    numAttr(desc, "Sharpness"),
  );
  if (sharpeningTouched) unsupported.push("선명하게 하기(Sharpening)");

  if (attr(desc, "OverrideLookVignette") === "True") {
    unsupported.push("Look 프로필 연동 비네트");
  }

  if (supported.length === 0) {
    warnings.push({
      code: "no_supported_adjustments",
      message: "이 프리셋에는 CREVENA가 적용할 수 있는 보정값이 없어요.",
    });
  }

  return {
    ok: true,
    presetName: readPresetName(desc, fallbackName),
    adjustments,
    supported,
    unsupported,
    warnings,
  };
}

function emptyFailure(fallbackName: string, message: string): XmpParseResult {
  return {
    ok: false,
    presetName: fallbackName,
    adjustments: {},
    supported: [],
    unsupported: [],
    warnings: [],
    error: message,
  };
}

export function hasAnySupportedAdjustment(adjustments: PhotoAdjustments): boolean {
  return Object.keys(adjustments).length > 0;
}
