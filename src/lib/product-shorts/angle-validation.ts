// Server-side validation of the AI's sales-angle / hook response. Anything that
// does not meet the contract is rejected (the route then refunds the credits)
// instead of being "fixed up" into something the model did not say.
//
// Ids ("a1", "h1", ...) are assigned HERE, never trusted from the model.

import {
  HOOK_MAX_CHARS,
  HOOK_MIN_CHARS,
  HOOK_STYLES,
  HOOKS_PER_ANGLE,
  MAX_ANGLES,
  MIN_ANGLES,
  RECOMMENDED_ANGLE_COUNT,
  RECOMMENDED_HOOK_COUNT,
  SALES_ANGLE_TYPES,
  type HookCandidate,
  type HookStyle,
  type SalesAngle,
  type SalesAngleType,
} from "./angle-types";
import { findUnsupportedClaims } from "./claim-guard";

export type AnglesValidation = { ok: true; angles: SalesAngle[] } | { ok: false; error: string };
export type HooksValidation = { ok: true; hooks: HookCandidate[] } | { ok: false; error: string };

const MIN_DISTINCT_HOOK_STYLES = 4;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function oneLine(v: unknown): string | null {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : null;
}

export function validateHooks(raw: unknown, sourceText: string): HooksValidation {
  if (!Array.isArray(raw)) return { ok: false, error: "후킹 목록 형식이 올바르지 않습니다." };
  if (raw.length !== HOOKS_PER_ANGLE) {
    return { ok: false, error: `후킹이 ${HOOKS_PER_ANGLE}개가 아닙니다 (${raw.length}개).` };
  }

  const hooks: HookCandidate[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!isRecord(item)) return { ok: false, error: "후킹 항목 형식이 올바르지 않습니다." };
    const text = oneLine(item.text);
    if (!text || text.length < HOOK_MIN_CHARS || text.length > HOOK_MAX_CHARS) {
      return { ok: false, error: `후킹 길이가 ${HOOK_MIN_CHARS}~${HOOK_MAX_CHARS}자 범위를 벗어났습니다.` };
    }
    if (!(HOOK_STYLES as readonly string[]).includes(item.style as string)) {
      return { ok: false, error: "알 수 없는 후킹 유형입니다." };
    }
    if (typeof item.recommended !== "boolean") return { ok: false, error: "후킹 추천 표시가 올바르지 않습니다." };
    const key = text.replace(/\s/g, "").toLowerCase();
    if (seen.has(key)) return { ok: false, error: "중복된 후킹이 있습니다." };
    seen.add(key);
    const unsupported = findUnsupportedClaims(text, sourceText);
    if (unsupported.length > 0) {
      return { ok: false, error: `근거 없는 표현이 후킹에 포함되어 있습니다 (${unsupported.join(", ")}).` };
    }
    hooks.push({ id: `h${i + 1}`, text, style: item.style as HookStyle, recommended: item.recommended });
  }

  if (hooks.filter((h) => h.recommended).length !== RECOMMENDED_HOOK_COUNT) {
    return { ok: false, error: `추천 후킹이 ${RECOMMENDED_HOOK_COUNT}개가 아닙니다.` };
  }
  if (new Set(hooks.map((h) => h.style)).size < MIN_DISTINCT_HOOK_STYLES) {
    return { ok: false, error: "후킹 유형이 충분히 다양하지 않습니다." };
  }
  return { ok: true, hooks };
}

export function validateAnglesResponse(raw: unknown, sourceText: string, hasPrice: boolean): AnglesValidation {
  const list = isRecord(raw) ? raw.angles : null;
  if (!Array.isArray(list)) return { ok: false, error: "판매각도 응답 형식이 올바르지 않습니다." };
  if (list.length < MIN_ANGLES || list.length > MAX_ANGLES) {
    return { ok: false, error: `판매각도 개수가 올바르지 않습니다 (${list.length}개).` };
  }

  const angles: SalesAngle[] = [];
  const usedTypes = new Set<SalesAngleType>();
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (!isRecord(item)) return { ok: false, error: "판매각도 항목 형식이 올바르지 않습니다." };
    if (!(SALES_ANGLE_TYPES as readonly string[]).includes(item.type as string)) {
      return { ok: false, error: "알 수 없는 판매각도 유형입니다." };
    }
    const type = item.type as SalesAngleType;
    if (usedTypes.has(type)) return { ok: false, error: "같은 유형의 판매각도가 중복되었습니다." };
    usedTypes.add(type);
    if (type === "VALUE" && !hasPrice) {
      return { ok: false, error: "가격 근거가 없는 상품에 가성비 각도가 만들어졌습니다." };
    }

    const title = oneLine(item.title);
    const rationale = oneLine(item.rationale);
    if (!title || title.length < 2 || title.length > 30) return { ok: false, error: "판매각도 제목 길이가 올바르지 않습니다." };
    if (!rationale || rationale.length < 5 || rationale.length > 120) {
      return { ok: false, error: "판매각도 설명 길이가 올바르지 않습니다." };
    }
    if (typeof item.recommended !== "boolean") return { ok: false, error: "판매각도 추천 표시가 올바르지 않습니다." };
    const unsupported = findUnsupportedClaims(`${title}\n${rationale}`, sourceText);
    if (unsupported.length > 0) {
      return { ok: false, error: `근거 없는 표현이 판매각도에 포함되어 있습니다 (${unsupported.join(", ")}).` };
    }

    const hooks = validateHooks(item.hooks, sourceText);
    if (!hooks.ok) return { ok: false, error: `${title}: ${hooks.error}` };

    angles.push({ id: `a${i + 1}`, type, title, rationale, recommended: item.recommended, hooks: hooks.hooks });
  }

  const expectedRecommended = Math.min(RECOMMENDED_ANGLE_COUNT, angles.length);
  if (angles.filter((a) => a.recommended).length !== expectedRecommended) {
    return { ok: false, error: `추천 판매각도가 ${expectedRecommended}개가 아닙니다.` };
  }
  return { ok: true, angles };
}
