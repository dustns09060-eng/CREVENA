// STEP43.5: shape of a parsed/applied XMP preset. This is exactly what gets
// stored in photo_presets.settings (jsonb) — never the raw XMP XML, and
// never a value CREVENA can't actually render (see xmp-parser.ts for what
// gets classified as supported vs. unsupported from a real Adobe XMP file).

export type HslBand = "red" | "orange" | "yellow" | "green" | "aqua" | "blue" | "purple" | "magenta";

export type HslAdjustment = { hue: number; saturation: number; luminance: number };

export type ToneCurvePoint = [number, number];

export type ColorGradeZone = { hue: number; saturation: number; luminance: number };

export interface PhotoAdjustments {
  exposure?: number; // EV, roughly -5..+5
  contrast?: number; // -100..100
  highlights?: number; // -100..100
  shadows?: number; // -100..100
  whites?: number; // -100..100
  blacks?: number; // -100..100

  temperature?: number; // incremental shift, roughly -100..100
  tint?: number; // incremental shift, roughly -100..100

  vibrance?: number; // -100..100
  saturation?: number; // -100..100

  clarity?: number; // -100..100 (coarse local-contrast approximation)
  texture?: number; // -100..100 (coarse local-contrast approximation)
  dehaze?: number; // -100..100 (coarse haze-removal approximation)

  hsl?: Partial<Record<HslBand, HslAdjustment>>;

  toneCurve?: {
    rgb?: ToneCurvePoint[];
    red?: ToneCurvePoint[];
    green?: ToneCurvePoint[];
    blue?: ToneCurvePoint[];
  };

  colorGrade?: {
    shadow?: ColorGradeZone;
    midtone?: ColorGradeZone;
    highlight?: ColorGradeZone;
    global?: ColorGradeZone;
    blending?: number; // 0..100
  };

  vignette?: { amount: number; midpoint: number; feather: number; roundness: number };
  grain?: { amount: number; size: number; frequency: number };
}

export interface XmpParseWarning {
  code: string;
  message: string;
}

export interface XmpParseResult {
  ok: boolean;
  presetName: string;
  adjustments: PhotoAdjustments;
  supported: string[]; // human-readable labels of properties that were applied
  unsupported: string[]; // human-readable labels of properties present in the file but not applied
  warnings: XmpParseWarning[];
  error?: string; // set when ok is false — always a safe, user-facing message
}
