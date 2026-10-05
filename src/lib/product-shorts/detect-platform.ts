// Shopping platform detection from a product URL.
//
// Pure and dependency-free (no network, no DNS): the platform is derived from
// the URL's hostname ONLY, using an exact-or-subdomain match against a fixed
// allow list. "coupang.com.invalid", "evilcoupang.com" and
// "coupang.com.evil.example" are therefore NOT Coupang — a hostname matches a
// domain only if it is that domain or ends with ".<domain>".
//
// Always call this on the SERVER with the URL the server itself holds; never
// trust a platform value that arrived from the client (see
// validate-product-source.ts).

export type ShoppingPlatform = "NAVER" | "COUPANG" | "TOSS_SHOPPING" | "GENERIC" | "MANUAL";

export const SHOPPING_PLATFORMS: readonly ShoppingPlatform[] = ["NAVER", "COUPANG", "TOSS_SHOPPING", "GENERIC", "MANUAL"];

export function isShoppingPlatform(value: unknown): value is ShoppingPlatform {
  return typeof value === "string" && (SHOPPING_PLATFORMS as readonly string[]).includes(value);
}

type Rule = {
  platform: Exclude<ShoppingPlatform, "GENERIC" | "MANUAL">;
  domains: readonly string[];
  // Optional path restriction for hosts that also serve unrelated pages.
  pathPrefixByDomain?: Readonly<Record<string, string>>;
};

const RULES: readonly Rule[] = [
  { platform: "NAVER", domains: ["smartstore.naver.com", "brand.naver.com", "shopping.naver.com"] },
  { platform: "COUPANG", domains: ["coupang.com", "coupa.ng"] },
  { platform: "TOSS_SHOPPING", domains: ["shopping.toss.im", "toss.im"], pathPrefixByDomain: { "toss.im": "/_m/" } },
];

function normalizeHostname(hostname: string): string {
  let host = hostname.toLowerCase();
  while (host.endsWith(".")) host = host.slice(0, -1); // "coupang.com." is the same host
  return host;
}

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

export function detectShoppingPlatform(sourceUrl: string | null | undefined): ShoppingPlatform {
  if (!sourceUrl || !sourceUrl.trim()) return "MANUAL";

  let url: URL;
  try {
    url = new URL(sourceUrl.trim());
  } catch {
    return "GENERIC";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "GENERIC";
  if (url.username || url.password) return "GENERIC";
  if (url.port && url.port !== "80" && url.port !== "443") return "GENERIC";

  const host = normalizeHostname(url.hostname);
  for (const rule of RULES) {
    for (const domain of rule.domains) {
      if (!hostMatches(host, domain)) continue;
      const prefix = rule.pathPrefixByDomain?.[domain];
      if (prefix && !url.pathname.startsWith(prefix)) continue;
      return rule.platform;
    }
  }
  return "GENERIC";
}

const PLATFORM_LABELS: Record<ShoppingPlatform, string> = {
  NAVER: "네이버",
  COUPANG: "쿠팡",
  TOSS_SHOPPING: "토스쇼핑",
  GENERIC: "기타 쇼핑몰",
  MANUAL: "직접 입력",
};

export function platformLabel(platform: ShoppingPlatform | null | undefined): string {
  // Projects saved before platform existed carry no value: read them as GENERIC.
  return PLATFORM_LABELS[platform ?? "GENERIC"];
}
