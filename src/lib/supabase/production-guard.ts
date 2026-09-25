// A single source of truth for "is this environment accidentally pointed at
// Production Supabase". Called from every place a Supabase client is
// constructed (client.ts, server.ts, service.ts, middleware.ts) so a
// misconfigured local .env.local can never silently read/write Production
// data through `next dev`.
//
// Deliberately keyed off NODE_ENV, not a custom flag: `next build` /
// `next start` — including a real Vercel Production deployment — always set
// NODE_ENV=production themselves, regardless of how they're invoked. This
// guard therefore only ever fires for `next dev`, which is exactly the
// scenario it exists to catch (a developer running the app locally against
// Production by mistake), and never interferes with a real build, a real
// `next start`, or a real Production deployment. The Production ref itself
// is defined ONCE, here, so nothing else in the codebase hardcodes it.
export const PRODUCTION_SUPABASE_PROJECT_REF = "iaifvagcjostzkjjkjww";

function extractProjectRef(url: string | undefined): string | null {
  if (!url) return null;
  const match = url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/);
  return match ? match[1] : null;
}

export function assertNotAccidentallyProduction() {
  if (process.env.NODE_ENV === "production") return; // real build/start/deploy — never blocked

  const ref = extractProjectRef(process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (ref === PRODUCTION_SUPABASE_PROJECT_REF) {
    throw new Error(
      `[production-guard] 로컬 개발 서버(next dev)가 Production Supabase 프로젝트(${PRODUCTION_SUPABASE_PROJECT_REF})를 ` +
        "가리키고 있습니다. .env.local의 NEXT_PUBLIC_SUPABASE_URL이 Development Supabase 프로젝트를 " +
        "가리키도록 수정한 뒤 다시 시작하세요. 이 오류는 실제 Production 배포(next build/next start, " +
        "NODE_ENV=production)에서는 절대 발생하지 않습니다 — 로컬 개발 환경에서만 동작하는 안전장치입니다.",
    );
  }
}
