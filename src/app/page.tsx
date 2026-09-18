import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PLAN_CONFIGS } from "@/lib/plans";
import { Button } from "@/components/ui/Button";
import { ArrowRightIcon, CheckIcon, ImageIcon } from "@/components/ui/Icon";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";

// STEP45: the landing page is the first thing a prospective paying customer
// sees, so its claims are held to the same standard as the policy pages —
// no invented user counts, no testimonials, no unverified % savings, and no
// wording that implies CREVENA posts to any SNS on the user's behalf. The
// pricing preview below reads PLAN_CONFIGS directly so it can never drift
// from the real charge amount.
export const metadata: Metadata = {
  title: { absolute: "CREVENA — 협찬 콘텐츠 제작 도구" },
  description:
    "협찬 가이드와 사진만 넣으면 블로그·Instagram·Threads·카드뉴스·Reels 콘텐츠 초안을 AI가 준비해 드립니다.",
};

// STEP43 item 10-15: CREVENA had no public marketing page at all — "/"
// unconditionally redirected to /dashboard, which middleware then bounced
// to /login for anyone signed out. This is a real page now; the auth check
// below is a defense-in-depth mirror of middleware.ts's own
// `user && isPublicPath -> /dashboard` rule (same established pattern as
// settings/billing/page.tsx's `if (!user) redirect("/login")`), not new
// authorization logic.
export default async function LandingPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  return (
    <div className="flex flex-1 flex-col">
      <PublicHeader />

      {/* Hero */}
      <section className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-4 py-16 text-center sm:px-6 sm:py-24">
          <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
            크리에이터를 위한 협찬 콘텐츠 제작 SaaS
          </span>
          {/* STEP45: `break-keep` (word-break: keep-all) is essential for
              Korean — without it the browser breaks inside a word, so
              "넣으세요" wrapped as "넣으세 / 요". Widened to max-w-3xl so the
              longer second line fits at sm:text-5xl. */}
          <h1 className="max-w-3xl text-3xl leading-tight font-bold break-keep text-zinc-900 sm:text-5xl">
            협찬 가이드와 사진만 넣으세요.
            <br />
            블로그부터 인스타·릴스까지 AI가 준비해드려요.
          </h1>
          <p className="max-w-xl text-sm leading-relaxed text-zinc-500 sm:text-base">
            CREVENA가 업체 협찬 가이드를 분석하고, 실제 사진과 직접 남긴 후기를 바탕으로 블로그·Instagram·Threads·카드뉴스·Reels
            콘텐츠 제작을 도와줍니다.
          </p>
          <div className="flex flex-col items-center gap-3 sm:flex-row">
            <Link href="/login?mode=signup">
              <Button size="lg">
                무료로 시작하기 <ArrowRightIcon size={16} />
              </Button>
            </Link>
            <Link href="/login">
              <Button variant="secondary" size="lg">
                로그인
              </Button>
            </Link>
          </div>
          <p className="text-xs text-zinc-400">신용카드 없이 FREE 플랜으로 바로 시작할 수 있어요.</p>

          {/* Product preview — CSS-based mockup of the real Content Studio
              tab bar, not a screenshot/stock image (item 56). */}
          <div className="mt-6 w-full max-w-2xl overflow-hidden rounded-xl border border-zinc-200 bg-white text-left shadow-sm">
            <div className="flex gap-1 border-b border-zinc-200 bg-zinc-50 px-4 pt-3">
              {["블로그", "Instagram", "Threads", "카드뉴스", "Reels"].map((label, i) => (
                <span
                  key={label}
                  className={`rounded-t-lg px-3 py-2 text-xs font-medium ${
                    i === 0 ? "border-b-2 border-brand-600 bg-white text-brand-700" : "text-zinc-400"
                  }`}
                >
                  {label}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-3 p-4 sm:grid-cols-4">
              <div className="col-span-1 flex aspect-square items-center justify-center rounded-lg bg-zinc-100 text-zinc-300">
                <ImageIcon size={22} />
              </div>
              <div className="col-span-2 flex flex-col gap-2 sm:col-span-3">
                <div className="h-3 w-2/3 rounded bg-zinc-200" />
                <div className="h-2.5 w-full rounded bg-zinc-100" />
                <div className="h-2.5 w-5/6 rounded bg-zinc-100" />
                <div className="h-2.5 w-3/4 rounded bg-zinc-100" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Workflow */}
      <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="text-center text-xl font-bold text-zinc-900 sm:text-2xl">이렇게 만들어요</h2>
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { n: "01", title: "가이드 넣기", desc: "업체에서 받은 협찬 가이드를 그대로 붙여넣으세요." },
            { n: "02", title: "사진·영상 추가하기", desc: "실제 촬영한 사진과 영상을 업로드하세요." },
            { n: "03", title: "AI 콘텐츠 만들기", desc: "가이드와 사진, 실제 경험을 바탕으로 초안을 만들어요." },
            { n: "04", title: "여러 채널로 활용하기", desc: "만든 콘텐츠를 다른 채널용으로 다시 활용하세요." },
          ].map((step) => (
            <div key={step.n} className="rounded-xl border border-zinc-200 bg-white p-5">
              <span className="text-2xl font-bold text-brand-200">{step.n}</span>
              <p className="mt-2 text-sm font-semibold text-zinc-900">{step.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-zinc-500">{step.desc}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 text-center text-xs text-zinc-400">
          만들 수 있는 콘텐츠: 블로그 · Instagram · Threads · 카드뉴스 · Reels
        </p>
        {/* STEP45: stated up front on the landing page, not buried in the
            terms — CREVENA has no SNS integration and never posts for the
            user. Setting that expectation before signup is the honest move. */}
        <p className="mx-auto mt-2 max-w-md text-center text-xs leading-relaxed text-zinc-400">
          완성된 콘텐츠는 복사해서 직접 게시하시면 돼요. CREVENA가 회원님의 SNS 계정에 대신 게시하지는 않아요.
        </p>
      </section>

      {/* Content Repurpose highlight */}
      <section className="border-y border-zinc-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-center text-xl font-bold text-zinc-900 sm:text-2xl">
            한 번 만든 콘텐츠를 다시 활용하세요.
          </h2>
          <p className="mx-auto mt-2 max-w-md text-center text-sm text-zinc-500">
            블로그를 쓰면 그 내용으로 Instagram·Threads·카드뉴스를 바로 만들 수 있어요.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center sm:gap-2">
            <div className="rounded-full border border-zinc-300 bg-zinc-50 px-4 py-2 text-sm font-medium text-zinc-700">
              블로그
            </div>
            <ArrowRightIcon size={16} className="rotate-90 text-zinc-300 sm:rotate-0" />
            <div className="flex flex-wrap justify-center gap-2">
              {["Instagram", "Threads", "카드뉴스"].map((label) => (
                <span key={label} className="rounded-full bg-brand-50 px-4 py-2 text-sm font-medium text-brand-700">
                  {label}
                </span>
              ))}
            </div>
          </div>
          <div className="mt-4 flex flex-col items-center gap-3 sm:flex-row sm:justify-center sm:gap-2">
            <div className="rounded-full border border-zinc-300 bg-zinc-50 px-4 py-2 text-sm font-medium text-zinc-700">
              카드뉴스
            </div>
            <ArrowRightIcon size={16} className="rotate-90 text-zinc-300 sm:rotate-0" />
            <span className="rounded-full bg-brand-50 px-4 py-2 text-sm font-medium text-brand-700">Reels</span>
          </div>
        </div>
      </section>

      {/* Trust */}
      <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="text-center text-xl font-bold text-zinc-900 sm:text-2xl">
            단순 AI 글쓰기 도구가 아니에요
        </h2>
        <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[
            "업체 가이드 분석 및 필수 항목 체크",
            "실제 업로드한 사진·영상 기반",
            "사용자가 직접 입력한 실제 경험 활용",
            "채널별로 다른 구조/톤으로 구성",
          ].map((text) => (
            <div key={text} className="flex items-start gap-2 rounded-xl border border-zinc-200 bg-white p-4">
              <CheckIcon size={16} className="mt-0.5 shrink-0 text-brand-600" />
              <span className="text-sm text-zinc-700">{text}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing preview — real PLAN_CONFIGS data, no invented numbers */}
      <section className="border-t border-zinc-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-center text-xl font-bold text-zinc-900 sm:text-2xl">요금제</h2>
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {Object.values(PLAN_CONFIGS).map((plan) => (
              <div key={plan.tier} className="flex flex-col rounded-xl border border-zinc-200 bg-white p-5">
                <span className="text-sm font-semibold text-zinc-500">{plan.label}</span>
                <span className="mt-1 text-2xl font-bold text-zinc-900">
                  {plan.monthlyPriceKrw === 0 ? "무료" : `₩${plan.monthlyPriceKrw.toLocaleString("ko-KR")}`}
                  {plan.monthlyPriceKrw > 0 && <span className="text-sm font-normal text-zinc-400">/월</span>}
                </span>
                <span className="mt-1 text-xs text-zinc-400">월 {plan.monthlyCreditLimit} 크레딧</span>
                <p className="mt-3 text-xs text-zinc-500">{plan.recommendedFor}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 flex justify-center">
            <Link href="/login?mode=signup">
              <Button size="lg">무료로 시작하기</Button>
            </Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
