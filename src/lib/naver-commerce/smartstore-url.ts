// Parses ONLY https://smartstore.naver.com/{store}/products/{channelProductNo}.
// The host must match exactly — lookalike hosts (smartstore.naver.com.evil.com,
// evil-smartstore.naver.com, brand.naver.com, ...) are rejected, so they can
// never reach the NAVER Commerce path. Brand Store URLs are intentionally NOT
// supported (not verified against the real API).

export type SmartstoreProductRef = {
  storeSlug: string;
  channelProductNo: string; // digits only
};

const SMARTSTORE_HOST = "smartstore.naver.com";
const STORE_SLUG = /^[A-Za-z0-9._-]{1,64}$/;
const PRODUCT_NO = /^[0-9]{1,20}$/;

export function parseSmartstoreProductUrl(input: string): SmartstoreProductRef | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.hostname.toLowerCase() !== SMARTSTORE_HOST) return null;
  if (url.username || url.password) return null;
  if (url.port && url.port !== "443" && url.port !== "80") return null;

  // Query string / hash (ad tracking parameters) are ignored, path is strict.
  const parts = url.pathname.split("/").filter((p, i) => !(i === 0 && p === ""));
  if (parts.length !== 3 || parts[1] !== "products") return null;
  const [storeSlug, , channelProductNo] = parts;
  if (!STORE_SLUG.test(storeSlug) || !PRODUCT_NO.test(channelProductNo)) return null;
  return { storeSlug, channelProductNo };
}
