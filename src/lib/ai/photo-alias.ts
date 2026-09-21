import type { PhotoSelectResponse } from "./photo-select-prompts";

// STEP47-3: short photo aliases for the AI protocol.
//
// WHY: a real 50-photo "AI로 사진 고르기" run needed 6615 output tokens, and
// 68% of the JSON the model wrote was 36-char UUIDs (167 occurrences across
// selectedPhotoIds / groups / reasons / requiredShots). UUIDs tokenize very
// badly, so id repetition — not Korean prose — is what breaks the 4096 cap.
// Inside the AI request/response only, every real photo id is replaced by
// "p1", "p2", ... and mapped back the moment the response arrives.
//
// WHAT THIS DOES NOT TOUCH: the real photo ids, collaborations.photo_select,
// and every UI/state shape. Nothing here is ever persisted — an alias exists
// for the duration of one request and is discarded after decoding.
//
// SAFETY: decoding is strict on purpose. An alias the model invented, a
// reference that isn't an alias at all (e.g. a raw UUID, including one from
// another collaboration), or a structurally broken response throws
// PhotoAliasError instead of being silently dropped — the caller must treat
// it as a failed call (route: refund + 422; client: nothing is saved).

/** Raised for any alias/shape problem in an AI response. */
export class PhotoAliasError extends Error {
  /** Which part of the response was bad — safe to log (never contains content). */
  readonly field: string;

  constructor(field: string) {
    super("AI 추천 결과를 확인하지 못했어요.\n다시 시도해 주세요.");
    this.name = "PhotoAliasError";
    this.field = field;
  }
}

export type PhotoAliasMap = {
  /** Number of aliased photos: aliases are exactly p1..p{count}. */
  readonly count: number;
  aliasOf(photoId: string): string | undefined;
  idOf(alias: string): string | undefined;
};

/**
 * Deterministic aliases in the order given: first id -> "p1", second -> "p2".
 * Duplicate ids share one alias. The same input order always yields the same
 * map, so the prompt and the decoder (built from one call) can never drift.
 */
export function createPhotoAliasMap(photoIdsInOrder: string[]): PhotoAliasMap {
  const toAlias = new Map<string, string>();
  const toId = new Map<string, string>();
  for (const id of photoIdsInOrder) {
    if (toAlias.has(id)) continue;
    const alias = `p${toAlias.size + 1}`;
    toAlias.set(id, alias);
    toId.set(alias, id);
  }
  return {
    count: toAlias.size,
    aliasOf: (photoId) => toAlias.get(photoId),
    idOf: (alias) => toId.get(alias),
  };
}

function refOf(value: unknown, map: PhotoAliasMap, field: string): string {
  if (typeof value !== "string") throw new PhotoAliasError(field);
  const id = map.idOf(value);
  if (id === undefined) throw new PhotoAliasError(field);
  return id;
}

function refsOf(value: unknown, map: PhotoAliasMap, field: string): string[] {
  if (!Array.isArray(value)) throw new PhotoAliasError(field);
  return value.map((v) => refOf(v, map, field));
}

function objectsOf(value: unknown, field: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new PhotoAliasError(field);
  return value.map((v) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new PhotoAliasError(field);
    return v as Record<string, unknown>;
  });
}

function asRecord(raw: unknown, field: string): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new PhotoAliasError(field);
  return raw as Record<string, unknown>;
}

/**
 * submit_photo_selection response -> the same shape with real photo ids.
 *
 * Strict about photo references and about structure that makes the result
 * unusable: every field of the schema's `required` list must be an array,
 * `selectedPhotoIds` and `reasons` must be non-empty (an empty `reasons` is
 * exactly what the STEP47-1 truncation looked like). Free-text fields and
 * the status/role enums stay lenient — sanitizePhotoSelection already
 * normalizes those, and rejecting them would only burn a call for nothing.
 */
export function decodePhotoSelectResponse(raw: unknown, map: PhotoAliasMap): PhotoSelectResponse {
  const r = asRecord(raw, "response");

  const selectedPhotoIds = refsOf(r.selectedPhotoIds, map, "selectedPhotoIds");
  if (selectedPhotoIds.length === 0) throw new PhotoAliasError("selectedPhotoIds");
  const coverCandidateIds = refsOf(r.coverCandidateIds, map, "coverCandidateIds");

  const requiredShots = objectsOf(r.requiredShots, "requiredShots").map((s) => ({
    requirement: typeof s.requirement === "string" ? s.requirement : "",
    status: typeof s.status === "string" ? s.status : "",
    photoIds: refsOf(s.photoIds, map, "requiredShots.photoIds"),
    note: typeof s.note === "string" ? s.note : "",
  }));

  const groups = objectsOf(r.groups, "groups").map((g) => ({
    photoIds: refsOf(g.photoIds, map, "groups.photoIds"),
    keepPhotoId: refOf(g.keepPhotoId, map, "groups.keepPhotoId"),
    reason: typeof g.reason === "string" ? g.reason : "",
  }));

  const reasons = objectsOf(r.reasons, "reasons").map((x) => ({
    photoId: refOf(x.photoId, map, "reasons.photoId"),
    reason: typeof x.reason === "string" ? x.reason : "",
    role: typeof x.role === "string" ? x.role : "",
  }));
  if (reasons.length === 0) throw new PhotoAliasError("reasons");

  return { selectedPhotoIds, coverCandidateIds, requiredShots, groups, reasons };
}

export type PhotoOrderResponse = {
  order: string[];
  primaryPhotoId?: string;
  excludePhotoIds?: string[];
};

/** submit_photo_order (legacy 사진 순서 추천) response -> real photo ids. */
export function decodePhotoOrderResponse(raw: unknown, map: PhotoAliasMap): PhotoOrderResponse {
  const r = asRecord(raw, "response");
  const order = refsOf(r.order, map, "order");
  if (order.length === 0) throw new PhotoAliasError("order");
  const out: PhotoOrderResponse = { order };
  if (r.primaryPhotoId !== undefined) out.primaryPhotoId = refOf(r.primaryPhotoId, map, "primaryPhotoId");
  if (r.excludePhotoIds !== undefined) out.excludePhotoIds = refsOf(r.excludePhotoIds, map, "excludePhotoIds");
  return out;
}

const PHOTO_SELECT_SCHEMA_NAME = "submit_photo_selection";
const PHOTO_ORDER_SCHEMA_NAME = "submit_photo_order";

/**
 * Server-side gate used by /api/ai/suggest-order BEFORE a call is counted as
 * a success. The route doesn't hold the real photo ids (the client builds the
 * prompt), but it doesn't need them: with `count` known, the only legal
 * references are exactly p1..p{count}. Validating against an identity map
 * checks structure + allowlist with the same strict decoders the client uses,
 * so a bad response is refunded server-side instead of costing 2 credits and
 * then failing in the browser.
 *
 * Returns silently for any other schema name (other AI routes/operations are
 * not aliased). Throws PhotoAliasError on a bad response.
 */
export function assertAliasedResponseValid(schemaName: string, content: string, aliasCount: number): void {
  if (schemaName !== PHOTO_SELECT_SCHEMA_NAME && schemaName !== PHOTO_ORDER_SCHEMA_NAME) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new PhotoAliasError("response");
  }
  const identity = createPhotoAliasMap(Array.from({ length: aliasCount }, (_, i) => `p${i + 1}`));
  if (schemaName === PHOTO_SELECT_SCHEMA_NAME) decodePhotoSelectResponse(parsed, identity);
  else decodePhotoOrderResponse(parsed, identity);
}

/** Largest alias count the route will accept from a client (sanity bound). */
export const MAX_PHOTO_ALIAS_COUNT = 500;
