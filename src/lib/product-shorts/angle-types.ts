// Sales angles ("판매각도") and hook candidates for Shopping Shorts Studio.
// Pure types/constants: no imports, so tests and server code can share them.

export const SALES_ANGLE_TYPES = ["PROBLEM_SOLVING", "VALUE", "FEATURE", "TARGET", "USE_SCENE", "COMPARE"] as const;
export type SalesAngleType = (typeof SALES_ANGLE_TYPES)[number];

export const SALES_ANGLE_LABELS: Record<SalesAngleType, string> = {
  PROBLEM_SOLVING: "문제 해결형",
  VALUE: "가성비형",
  FEATURE: "특징형",
  TARGET: "타깃형",
  USE_SCENE: "사용상황형",
  COMPARE: "비교/선택형",
};

export const HOOK_STYLES = ["PROBLEM", "EMPATHY", "QUESTION", "TARGET", "FEATURE", "USE_SCENE", "CONCLUSION"] as const;
export type HookStyle = (typeof HOOK_STYLES)[number];

export const HOOK_STYLE_LABELS: Record<HookStyle, string> = {
  PROBLEM: "문제제기형",
  EMPATHY: "공감형",
  QUESTION: "질문형",
  TARGET: "타깃형",
  FEATURE: "특징형",
  USE_SCENE: "사용상황형",
  CONCLUSION: "결론형",
};

export type HookCandidate = {
  id: string; // "h1".."h10" — assigned by the server, never taken from the AI
  text: string;
  style: HookStyle;
  recommended: boolean;
};

export type SalesAngle = {
  id: string; // "a1".."a5" — assigned by the server
  type: SalesAngleType;
  title: string;
  rationale: string;
  recommended: boolean;
  hooks: HookCandidate[];
};

export type AngleSuggestionSet = {
  generatedAt: string;
  angles: SalesAngle[];
};

// What a version stores about the angle it was built on (no hook list).
export type VersionAngle = Pick<SalesAngle, "type" | "title" | "rationale">;

export const MIN_ANGLES = 2; // an angle is never invented just to reach 5
export const MAX_ANGLES = 5;
export const RECOMMENDED_ANGLE_COUNT = 3;
export const HOOKS_PER_ANGLE = 10;
export const RECOMMENDED_HOOK_COUNT = 3;
export const HOOK_MIN_CHARS = 6;
export const HOOK_MAX_CHARS = 40;
export const MAX_VERSIONS = 3; // labels A, B, C
export const VERSION_LABELS = ["A", "B", "C"] as const;
export type VersionLabel = (typeof VERSION_LABELS)[number];
