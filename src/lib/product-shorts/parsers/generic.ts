import type { ProductEvidence, ProductSource } from "../types";

// GenericProductParser: schema.org JSON-LD Product -> OpenGraph -> meta/title,
// in that priority order (per the Phase 2 design). No shopping-mall-specific
// DOM selectors anywhere in this file — that is the entire point of this
// being "generic". Nothing here infers or fills in a fact that isn't
// literally present in the HTML; a field simply stays unset if not found,
// and only fields that WERE found get an evidence[] entry.
//
// No HTML parser library is used (none exists in this project's
// dependencies, and adding one is out of scope for this PR) — extraction is
// regex-based, narrowly scoped to the few tag/attribute shapes being read
// (script[type=application/ld+json], meta[property]/meta[name]/title). This
// is a deliberate trade-off: less robust than a real DOM parser against
// malformed HTML, but sufficient for well-formed product pages and adds no
// new dependency.

function extractJsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const scriptRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptRe.exec(html))) {
    try {
      blocks.push(JSON.parse(match[1].trim()));
    } catch {
      // Malformed JSON-LD block — skip it, never guess at its content.
    }
  }
  return blocks;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// JSON-LD can appear as: a single object, an array of objects, or an object
// with an "@graph" array — and any of those can mix multiple @types
// together, with zero or more actually being "Product". This walks all of
// that and returns every node whose @type is (or includes) "Product".
function findProductNodes(blocks: unknown[]): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  function isProductType(type: unknown): boolean {
    if (typeof type === "string") return type === "Product";
    if (Array.isArray(type)) return type.includes("Product");
    return false;
  }
  function walk(node: unknown) {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (!isRecord(node)) return;
    if (isProductType(node["@type"])) found.push(node);
    if (Array.isArray(node["@graph"])) walk(node["@graph"]);
  }
  for (const block of blocks) walk(block);
  return found;
}

function textOf(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  // schema.org allows { "@value": "..." } / { "name": "..." } shapes too.
  if (isRecord(value)) {
    if (typeof value["@value"] === "string") return value["@value"].trim() || undefined;
    if (typeof value.name === "string") return value.name.trim() || undefined;
  }
  return undefined;
}

function priceFromOffers(offers: unknown): string | undefined {
  const offer = Array.isArray(offers) ? offers[0] : offers;
  if (!isRecord(offer)) return undefined;
  const price = offer.price;
  const currency = offer.priceCurrency;
  if (price === undefined && price === null) return undefined;
  const priceStr = typeof price === "number" ? String(price) : textOf(price);
  if (!priceStr) return undefined;
  return typeof currency === "string" ? `${priceStr} ${currency}` : priceStr;
}

function imagesFromNode(node: Record<string, unknown>): string[] {
  const image = node.image;
  if (typeof image === "string") return [image];
  if (Array.isArray(image)) return image.filter((v): v is string => typeof v === "string");
  if (isRecord(image) && typeof image.url === "string") return [image.url];
  return [];
}

function parseJsonLd(html: string, evidence: ProductEvidence[]): Partial<ProductSource> | null {
  const nodes = findProductNodes(extractJsonLdBlocks(html));
  if (nodes.length === 0) return null;
  // Prefer the node with the most usable fields rather than blindly the first.
  const node = nodes
    .map((n) => ({ n, score: [n.name, n.description, n.offers, n.image].filter(Boolean).length }))
    .sort((a, b) => b.score - a.score)[0].n;

  const result: Partial<ProductSource> = {};
  const name = textOf(node.name);
  if (name) {
    result.productName = name;
    evidence.push({ field: "productName", value: name, source: "JSON_LD" });
  }
  const description = textOf(node.description);
  if (description) {
    result.description = description;
    evidence.push({ field: "description", value: description, source: "JSON_LD" });
  }
  const price = priceFromOffers(node.offers);
  if (price) {
    result.priceText = price;
    evidence.push({ field: "priceText", value: price, source: "JSON_LD" });
  }
  const images = imagesFromNode(node);
  if (images.length > 0) {
    result.imageCandidates = images;
    for (const img of images) evidence.push({ field: "imageCandidates[]", value: img, source: "JSON_LD" });
  }
  return result;
}

function extractMetaContent(html: string, attr: "property" | "name", key: string): string | undefined {
  // Handles both attribute orders: <meta property="x" content="y"> and
  // <meta content="y" property="x">, both quote styles.
  const patterns = [
    new RegExp(`<meta[^>]*${attr}=["']${key}["'][^>]*content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*${attr}=["']${key}["']`, "i"),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1].trim()) return m[1].trim();
  }
  return undefined;
}

function parseOpenGraph(html: string, evidence: ProductEvidence[]): Partial<ProductSource> {
  const result: Partial<ProductSource> = {};
  const title = extractMetaContent(html, "property", "og:title");
  if (title) {
    result.productName = title;
    evidence.push({ field: "productName", value: title, source: "OPEN_GRAPH" });
  }
  const description = extractMetaContent(html, "property", "og:description");
  if (description) {
    result.description = description;
    evidence.push({ field: "description", value: description, source: "OPEN_GRAPH" });
  }
  const image = extractMetaContent(html, "property", "og:image");
  if (image) {
    result.imageCandidates = [image];
    evidence.push({ field: "imageCandidates[]", value: image, source: "OPEN_GRAPH" });
  }
  return result;
}

function parseMetaTitle(html: string, evidence: ProductEvidence[]): Partial<ProductSource> {
  const result: Partial<ProductSource> = {};
  const description = extractMetaContent(html, "name", "description");
  if (description) {
    result.description = description;
    evidence.push({ field: "description", value: description, source: "META" });
  }
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch?.[1]?.trim();
  if (title) {
    result.productName = title;
    evidence.push({ field: "productName", value: title, source: "META" });
  }
  return result;
}

// Merges, without ever overwriting a field that JSON-LD/OG already filled
// with a lower-priority source's guess.
function mergePreferFirst(base: Partial<ProductSource>, addition: Partial<ProductSource>) {
  for (const key of Object.keys(addition) as (keyof ProductSource)[]) {
    if (base[key] === undefined) (base as Record<string, unknown>)[key] = addition[key];
  }
}

export function parseGenericProductPage(html: string, url: URL): ProductSource | null {
  const evidence: ProductEvidence[] = [];
  const merged: Partial<ProductSource> = {};

  const jsonLd = parseJsonLd(html, evidence);
  if (jsonLd) mergePreferFirst(merged, jsonLd);

  const og = parseOpenGraph(html, evidence);
  mergePreferFirst(merged, og);

  const meta = parseMetaTitle(html, evidence);
  mergePreferFirst(merged, meta);

  if (!merged.productName) return null; // nothing usable was found at all

  return {
    sourceUrl: url.toString(),
    sourceHost: url.hostname,
    productName: merged.productName,
    priceText: merged.priceText ?? null,
    description: merged.description ?? null,
    features: [], // no generic, safe way to extract structured "features" without a shopping-mall-specific selector — left empty rather than guessed
    imageCandidates: merged.imageCandidates ?? [],
    evidence,
  };
}
