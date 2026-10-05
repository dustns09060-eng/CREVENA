import { test } from "node:test";
import assert from "node:assert/strict";
import { detectShoppingPlatform, platformLabel } from "../src/lib/product-shorts/detect-platform";
import { sanitizeProductSource } from "../src/lib/product-shorts/validate-product-source";
import { mediaTypeForAi } from "../src/lib/product-shorts/validate-image";
import { MAX_PHOTO_BYTES, uploadProductShortsPhoto } from "../src/lib/product-shorts/upload-photo";
import { buildManualProductSource } from "../src/lib/product-shorts/product-source-helpers";

test("platform detector: real hosts", () => {
  assert.equal(detectShoppingPlatform("https://www.coupang.com/vp/products/123?itemId=1"), "COUPANG");
  assert.equal(detectShoppingPlatform("https://coupa.ng/abcd"), "COUPANG");
  assert.equal(detectShoppingPlatform("https://link.coupang.com/a/xyz"), "COUPANG");
  assert.equal(detectShoppingPlatform("https://smartstore.naver.com/store/products/1"), "NAVER");
  assert.equal(detectShoppingPlatform("https://m.smartstore.naver.com/store/products/1"), "NAVER");
  assert.equal(detectShoppingPlatform("https://shopping.toss.im/products/1"), "TOSS_SHOPPING");
  assert.equal(detectShoppingPlatform("https://toss.im/_m/abcDE"), "TOSS_SHOPPING");
  assert.equal(detectShoppingPlatform("https://WWW.COUPANG.COM./vp/products/1"), "COUPANG"); // case + trailing dot
});

test("platform detector: spoofed or unrelated hosts are never a known platform", () => {
  for (const u of [
    "https://coupang.com.invalid/vp/products/1",
    "https://evilcoupang.com/x",
    "https://coupang.com.evil.example/x",
    "https://www.coupang.com@evil.example/x",
    "https://evil.example/www.coupang.com",
    "https://evil.example/?u=https://www.coupang.com",
    "https://smartstore.naver.com.evil.example/s/products/1",
    "https://fakesmartstore.naver.com.example/x",
    "https://toss.im/other-page", // toss.im only counts under /_m/
    "https://toss.im.evil.example/_m/x",
    "https://www.coupang.com:8443/x",
    "ftp://www.coupang.com/x",
    "javascript:alert(1)",
    "not a url",
  ]) {
    assert.equal(detectShoppingPlatform(u), "GENERIC", u);
  }
  assert.equal(detectShoppingPlatform("https://shop.example.com/p/1"), "GENERIC");
});

test("platform detector: no URL means MANUAL; missing stored platform is read as GENERIC", () => {
  assert.equal(detectShoppingPlatform(null), "MANUAL");
  assert.equal(detectShoppingPlatform(""), "MANUAL");
  assert.equal(platformLabel(undefined), "기타 쇼핑몰");
  assert.equal(platformLabel("COUPANG"), "쿠팡");
  assert.equal(platformLabel("TOSS_SHOPPING"), "토스쇼핑");
  assert.equal(platformLabel("NAVER"), "네이버");
});

const base = () => ({
  sourceUrl: "https://shop.example.com/p/1",
  sourceHost: "forged.example",
  platform: "COUPANG",
  productName: "상품",
  priceText: "1,000원",
  description: null,
  features: ["a"],
  imageCandidates: ["https://cdn.example.com/a.jpg", "javascript:alert(1)"],
  evidence: [{ field: "productName", value: "상품", source: "JSON_LD" }],
});

test("ProductSource sanitizer: client platform/host are ignored and recomputed", () => {
  const r = sanitizeProductSource(base());
  assert.ok(r.ok);
  assert.equal(r.source.platform, "GENERIC");
  assert.equal(r.source.sourceHost, "shop.example.com");
  assert.deepEqual(r.source.imageCandidates, ["https://cdn.example.com/a.jpg"]);
  const coupang = sanitizeProductSource({ ...base(), sourceUrl: "https://www.coupang.com/vp/products/1" });
  assert.ok(coupang.ok);
  assert.equal(coupang.source.platform, "COUPANG");
  const manual = sanitizeProductSource({ ...base(), sourceUrl: null });
  assert.ok(manual.ok);
  assert.equal(manual.source.platform, "MANUAL");
  assert.equal(manual.source.sourceHost, null);
});

test("ProductSource sanitizer: forged or malformed evidence is rejected", () => {
  const withEvidence = (e: unknown[]) => sanitizeProductSource({ ...base(), evidence: e });
  assert.equal(withEvidence([{ field: "productName", value: "x", source: "COUPANG_API" }]).ok, false);
  assert.equal(withEvidence([{ field: "salesRank", value: "1위", source: "USER" }]).ok, false);
  assert.equal(withEvidence([{ field: "productName", value: 5, source: "USER" }]).ok, false);
  // NAVER_COMMERCE evidence is only valid for a NAVER URL and the fields that adapter fills
  assert.equal(withEvidence([{ field: "productName", value: "x", source: "NAVER_COMMERCE" }]).ok, false);
  const naverUrl = "https://smartstore.naver.com/store/products/1";
  assert.equal(
    sanitizeProductSource({ ...base(), sourceUrl: naverUrl, evidence: [{ field: "productName", value: "x", source: "NAVER_COMMERCE" }] }).ok,
    true,
  );
  assert.equal(
    sanitizeProductSource({ ...base(), sourceUrl: naverUrl, evidence: [{ field: "description", value: "x", source: "NAVER_COMMERCE" }] }).ok,
    false,
  );
});

test("ProductSource sanitizer: structural problems are rejected", () => {
  assert.equal(sanitizeProductSource(null).ok, false);
  assert.equal(sanitizeProductSource({ ...base(), productName: "  " }).ok, false);
  assert.equal(sanitizeProductSource({ ...base(), sourceUrl: "ftp://x.example" }).ok, false);
  assert.equal(sanitizeProductSource({ ...base(), sourceUrl: "https://u:p@shop.example.com/" }).ok, false);
  assert.equal(sanitizeProductSource({ ...base(), features: "nope" }).ok, false);
});

test("ProductSource sanitizer accepts what the app itself produces", () => {
  const manual = buildManualProductSource({ productName: "물티슈", priceText: "9,900원", features: ["두껍다"], sourceUrl: "https://www.coupang.com/vp/products/9" });
  const r = sanitizeProductSource(manual);
  assert.ok(r.ok);
  assert.equal(r.source.platform, "COUPANG");
  assert.equal(manual.platform, "COUPANG");
});

test("photo analysis: media type follows the real bytes (PNG/WEBP are not sent as JPEG)", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  assert.equal(mediaTypeForAi(png), "image/png");
  assert.equal(mediaTypeForAi(webp), "image/webp");
  assert.equal(mediaTypeForAi(jpeg), "image/jpeg");
});

test("upload: server rejects oversized photo/thumbnail before touching storage", async () => {
  const fakeSupabase = new Proxy({}, { get() { throw new Error("storage/db must not be touched for oversize input"); } });
  // project lookup happens first in the real function; build a client that answers it and nothing else
  const answers = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "p", user_id: "u" }, error: null }) }) }) }),
    storage: fakeSupabase,
  };
  const big = new Uint8Array(MAX_PHOTO_BYTES + 1);
  const r1 = await uploadProductShortsPhoto(answers as never, "u", { projectId: "p", photoBytes: big, thumbnailBytes: new Uint8Array(10) });
  assert.ok("error" in r1);
  const r2 = await uploadProductShortsPhoto(answers as never, "u", { projectId: "p", photoBytes: new Uint8Array(10), thumbnailBytes: new Uint8Array(600 * 1024) });
  assert.ok("error" in r2);
});
