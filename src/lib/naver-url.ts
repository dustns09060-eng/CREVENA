// STEP38: minimal, client-safe format validation for a published Naver Blog
// post URL. No network fetch (per spec: "외부 URL을 서버에서 임의 fetch하지
// 않는다") — this only checks the URL's shape, never that it's reachable or
// that the post actually exists.
export function isValidNaverBlogUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return false;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return false;

  const host = url.hostname.toLowerCase();
  const isNaverBlogHost = host === "blog.naver.com" || host === "m.blog.naver.com";
  if (!isNaverBlogHost) return false;

  // A real post URL is /{blogId}/{logNo} (or ?blogId=...&logNo=... on some
  // older links) — reject the bare blog home ("/") as "not a post link yet".
  const hasPathSegments = url.pathname.split("/").filter(Boolean).length >= 2;
  const hasQueryIds = url.searchParams.has("blogId") && url.searchParams.has("logNo");
  return hasPathSegments || hasQueryIds;
}
