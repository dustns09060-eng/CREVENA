import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { secureFetchHtml } from "@/lib/product-shorts/secure-fetch";
import { parseGenericProductPage } from "@/lib/product-shorts/parsers/generic";
import { lookupNaverSelfProduct } from "@/lib/naver-commerce/lookup";

// This route uses node:http/node:https/node:dns directly (see
// secure-fetch.ts), which the Edge runtime does not support — must run on
// Node.
export const runtime = "nodejs";

// Authenticated (any signed-in member — no AI is used here, so no credit
// check either; see the PR report's "credits" section: URL parsing = 0
// credits by design). No admin/role check needed: this never exposes
// another user's data, it only fetches a public URL the caller supplied.
//
// This route does NOT touch product_shorts_projects/product_shorts_media —
// it is a pure "try to understand this URL" step. Persisting a project is a
// separate, later step (not implemented in this Phase 3A slice).
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const url = body?.url;
  if (typeof url !== "string" || !url) {
    return NextResponse.json({ ok: false, code: "INVALID_URL" }, { status: 400 });
  }

  // Belt-and-braces: even an unexpected exception (a bug, not a designed
  // failure) must never reach the client as a raw message/stack trace —
  // everything below funnels through the same fixed code vocabulary.
  try {
    // SmartStore product URLs go to the official NAVER Commerce API (operator
    // SELF app) instead of scraping the public page. Anything else continues
    // to the generic parser below, unchanged. The response carries only a
    // fixed code on failure — never NAVER's error text.
    const naver = await lookupNaverSelfProduct({ url, userId: user.id });
    if (naver.handled) {
      if (!naver.ok) {
        console.error(`[product-shorts] analyze-url naver code=${naver.code}`);
        return NextResponse.json({ ok: false, code: naver.code }, { status: 200 });
      }
      return NextResponse.json({ ok: true, productSource: naver.productSource });
    }

    const fetchResult = await secureFetchHtml(url);
    if (!fetchResult.ok) {
      // Server-side only — `detail` never leaves this function. The client
      // gets exactly one of the fixed codes in ProductShortsErrorCode,
      // never upstream error text, a stack trace, or any DNS/IP detail.
      if (fetchResult.detail) {
        console.error(`[product-shorts] analyze-url code=${fetchResult.code} detail=${fetchResult.detail}`);
      }
      // "상품 정보를 자동으로 불러오지 못했습니다." class of failure — this
      // must never be treated as a hard error by the caller; the
      // manual-entry fallback (not built in this slice) is what a real
      // failure routes to.
      return NextResponse.json({ ok: false, code: fetchResult.code }, { status: 200 });
    }

    const finalUrl = new URL(fetchResult.finalUrl);
    const productSource = parseGenericProductPage(fetchResult.html, finalUrl);
    if (!productSource) {
      return NextResponse.json({ ok: false, code: "PRODUCT_NOT_FOUND" }, { status: 200 });
    }

    return NextResponse.json({ ok: true, productSource });
  } catch (error) {
    console.error("[product-shorts] analyze-url unexpected error", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, code: "FETCH_FAILED" }, { status: 200 });
  }
}
