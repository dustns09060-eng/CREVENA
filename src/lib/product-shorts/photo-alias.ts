// NEW for Product Shorts — NOT a reuse of an existing "STEP47.3 alias"
// mechanism. Verified by search before writing this: no alias/p1/p2-style
// mapping exists anywhere in the merged codebase (STEP47 Photo Select
// sends real photo UUIDs straight into the prompt and instead defends
// against hallucination with post-response validation against the real id
// set — see src/lib/photo-select.ts's sanitizePhotoSelection). This file is
// a small, self-contained addition built for this phase's explicit request
// to avoid repeating UUIDs in the prompt/response.
//
// Aliases are per-request, ephemeral, and never persisted — a fresh map is
// built right before each AI call and only used to translate that one
// call's prompt/response.

export type PhotoAliasMap = Map<string, string>; // mediaId (uuid) -> alias ("p1", "p2", ...)

export function buildPhotoAliasMap(mediaIds: string[]): PhotoAliasMap {
  const map: PhotoAliasMap = new Map();
  mediaIds.forEach((id, i) => map.set(id, `p${i + 1}`));
  return map;
}

export function invertAliasMap(map: PhotoAliasMap): Map<string, string> {
  return new Map([...map.entries()].map(([uuid, alias]) => [alias, uuid]));
}

// Resolves an AI-returned alias back to a real mediaId. Returns null for
// anything that isn't a known alias — malformed, hallucinated, or an alias
// from a different call — so the caller can treat it as a validation
// failure rather than silently drop or misattribute it.
export function resolveAlias(alias: unknown, aliasToUuid: Map<string, string>): string | null {
  if (typeof alias !== "string") return null;
  return aliasToUuid.get(alias) ?? null;
}
