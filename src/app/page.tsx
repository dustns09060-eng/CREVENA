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
// wording that implies CREVENA posts to any SNS on the user's behalf.
//
// Launch positioning: CREVENA is presented as an all-in-one workflow for
// 체험단·협찬 콘텐츠 (guide -> photos -> photo recommendation -> content ->
// guide check -> other channels), not as a generic "AI content generator".
// Every capability named below exists in the app today:
//   - 가이드 분석 (GUIDE_ANALYZE), 사진 분석 (PHOTO_ANALYSIS)
//   - AI 사진 추천 incl. 비슷한 사진 묶기 and 필수 촬영컷 부족 확인 (STEP47)
//   - 블로그 / Instagram / Threads 콘텐츠 생성, Carousel PNG·ZIP,
//     Reels MP4, 네이버 클립 MP4 + 게시 문구, 네이버 블로그 발행 도우미
//   - AI 가이드 검사 (GUIDE_CHECK)
// Nothing here says or implies automatic posting: 발행 도우미 / 게시 문구는
// 준비·복사까지이며 실제 게시는 사용자가 직접 한다.
//
// Photo selection copy is deliberately modest (an AI *recommendation* the user
// can change) — no "picks the perfect photo" claims. The no-fabrication copy
// says how the product is designed, never "100% factual".
//
// The pricing preview reads PLAN_CONFIGS directly (the same source /pricing
// uses), and so does the final CTA's credit line, so no price or credit
// number is hardcoded on this page.
export const metadata: Metadata = {
  title: { absolute: "CREVENA — 체험단·협찬 콘텐츠 제작 올인원" },
  description:
    "협찬 가이드를 분석하고, 촬영한 사진에서 사용할 컷을 골라 블로그부터 인스타·릴스까지 채널에 맞는 콘텐츠 제작을 도와드려요.",
};

const PROBLEMS = [
  { n: "01", title: "긴 협찬 가이드", quote: "필수 키워드와 미션을 하나씩 확인해야 해요." },
  { n: "02", title: "너무 많은 사진", quote: "비슷한 사진 중 어떤 컷을 써야 할지 고민돼요." },
  { n: "03", title: "채널마다 다시 작성", quote: "블로그를 쓰고 인스타와 숏폼도 다시 준비해야 해요." },
  { n: "04", title: "제출 전 누락 걱정", quote: "필수 내용이나 촬영 미션을 빠뜨리지 않았는지 다시 확인해요." },
] as const;

const WORKFLOW = [
  {
    n: "01",
    title: "가이드 분석",
    desc: "업체에서 받은 협찬 가이드를 입력하면 필수 키워드와 콘텐츠 조건을 정리합니다.",
  },
  {
    n: "02",
    title: "사진 분석",
    desc: "촬영한 사진을 분석해 콘텐츠에 활용할 수 있도록 준비합니다.",
  },
  {
    n: "03",
    title: "AI 사진 추천",
    desc: "여러 사진 중 사용할 사진과 순서를 추천하고 필요한 촬영컷이 부족한지도 확인합니다.",
  },
  {
    n: "04",
    title: "콘텐츠 제작",
    desc: "실제 경험과 사진을 바탕으로 채널에 맞는 콘텐츠를 제작합니다.",
  },
  {
    n: "05",
    title: "가이드 확인",
    desc: "작성한 콘텐츠가 가이드 조건을 놓치지 않았는지 확인합니다.",
  },
] as const;

// What each channel actually gets. Labels describe preparation, never posting.
const OUTPUTS = [
  { name: "네이버 블로그", role: "발행 보조" },
  { name: "Instagram", role: "콘텐츠 생성" },
  { name: "Threads", role: "콘텐츠 생성" },
  { name: "Carousel", role: "PNG / ZIP 제작" },
  { name: "Reels", role: "MP4 제작" },
  { name: "Naver Clip", role: "MP4 + 게시 문구 제작" },
] as const;

const TARGETS = [
  { title: "체험단을 꾸준히 하는 분", quote: "매번 가이드와 사진을 정리하는 시간이 아까웠다면" },
  { title: "블로그 + SNS를 함께 운영하는 분", quote: "같은 제품으로 여러 채널 콘텐츠를 만들어야 한다면" },
  { title: "사진을 많이 촬영하는 분", quote: "수십 장의 사진 중 사용할 사진을 고르는 데 시간이 걸린다면" },
  {
    title: "협찬 콘텐츠가 쌓이고 있는 크리에이터",
    quote: "반복되는 제작 과정을 조금 더 체계적으로 관리하고 싶다면",
  },
] as const;

const GENERIC_FLOW = ["주제 입력", "글 생성"] as const;
const CREVENA_FLOW = ["협찬 가이드", "사진", "AI 사진 추천", "콘텐츠 제작", "가이드 확인", "채널별 활용"] as const;

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
            체험단 · 협찬 콘텐츠 제작 올인원
          </span>
          {/* STEP45: `break-keep` (word-break: keep-all) is essential for
              Korean — without it the browser breaks inside a word. */}
          <h1 className="max-w-4xl text-2xl leading-tight font-bold break-keep text-zinc-900 sm:text-4xl lg:text-[2.75rem]">
            협찬 가이드와 사진만 넣으세요.
            <br />
            콘텐츠 제작은 CREVENA가 도와드릴게요.
          </h1>
          <p className="max-w-xl text-sm leading-relaxed break-keep text-zinc-500 sm:text-base">
            복잡한 협찬 가이드를 AI가 분석하고, 촬영한 사진에서 사용할 컷을 골라 블로그부터 인스타·릴스까지 채널에 맞는
            콘텐츠 제작을 도와드려요.
          </p>
          <div className="flex flex-col items-center gap-3 sm:flex-row">
            <Link href="/login?mode=signup">
              <Button size="lg">
                무료로 시작하기 <ArrowRightIcon size={16} />
              </Button>
            </Link>
            <Link href="#workflow">
              <Button variant="secondary" size="lg">
                어떻게 만들어지나요?
              </Button>
            </Link>
          </div>
          <p className="text-xs text-zinc-400">신용카드 없이 FREE 플랜으로 바로 시작할 수 있어요.</p>

          {/* Product preview — CSS-based mockup of the real Content Studio
              tab bar, not a screenshot/stock image (item 56). */}
          <div className="mt-6 w-full max-w-2xl overflow-hidden rounded-xl border border-zinc-200 bg-white text-left shadow-sm">
            <div className="flex gap-1 overflow-x-auto border-b border-zinc-200 bg-zinc-50 px-4 pt-3">
              {["블로그", "Instagram", "Threads", "카드뉴스", "Reels"].map((label, i) => (
                <span
                  key={label}
                  className={`shrink-0 rounded-t-lg px-3 py-2 text-xs font-medium ${
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

      {/* Problem */}
      <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="text-center text-xl font-bold break-keep text-zinc-900 sm:text-2xl">
          체험단 하나 작성하는데
          <br className="sm:hidden" /> 왜 이렇게 할 일이 많을까요?
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-center text-sm leading-relaxed break-keep text-zinc-500">
          가이드 다시 읽고, 필수 키워드 확인하고, 수십 장의 사진 중 사용할 사진을 고르고, 사진 순서를 정하고, 블로그를
          작성한 뒤 인스타와 릴스용 콘텐츠까지 다시 준비하는 과정.
        </p>
        <p className="mx-auto mt-2 max-w-2xl text-center text-sm font-medium leading-relaxed break-keep text-zinc-700">
          CREVENA는 이 반복 작업을 하나의 제작 흐름으로 연결합니다.
        </p>
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PROBLEMS.map((p) => (
            <div key={p.n} className="rounded-xl border border-zinc-200 bg-white p-5">
              <span className="text-2xl font-bold text-brand-200">{p.n}</span>
              <p className="mt-2 text-sm font-semibold text-zinc-900">{p.title}</p>
              <p className="mt-1 text-xs leading-relaxed break-keep text-zinc-500">“{p.quote}”</p>
            </div>
          ))}
        </div>
      </section>

      {/* Core workflow */}
      <section id="workflow" className="border-y border-zinc-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-center text-xl font-bold break-keep text-zinc-900 sm:text-2xl">
            가이드부터 콘텐츠까지
            <br className="sm:hidden" /> 한 흐름으로
          </h2>
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {WORKFLOW.map((step) => (
              <div key={step.n} className="rounded-xl border border-zinc-200 bg-white p-5">
                <span className="text-2xl font-bold text-brand-200">{step.n}</span>
                <p className="mt-2 text-sm font-semibold text-zinc-900">{step.title}</p>
                <p className="mt-1 text-xs leading-relaxed break-keep text-zinc-500">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Outputs */}
      <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="text-center text-xl font-bold break-keep text-zinc-900 sm:text-2xl">
          한 번 준비하고,
          <br className="sm:hidden" /> 여러 채널에 활용하세요.
        </h2>
        <p className="mx-auto mt-3 max-w-md text-center text-sm leading-relaxed break-keep text-zinc-500">
          블로그 콘텐츠를 기반으로 다른 채널에 맞는 형태로 다시 준비할 수 있어요.
        </p>
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {OUTPUTS.map((o) => (
            <div key={o.name} className="rounded-xl border border-zinc-200 bg-white p-4">
              <p className="text-sm font-semibold text-zinc-900">{o.name}</p>
              <span className="mt-2 inline-block rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium break-keep text-brand-700">
                {o.role}
              </span>
            </div>
          ))}
        </div>
        {/* STEP45: stated up front on the landing page, not buried in the
            terms — CREVENA has no SNS integration and never posts for the
            user. Setting that expectation before signup is the honest move. */}
        <p className="mx-auto mt-5 max-w-md text-center text-xs leading-relaxed break-keep text-zinc-400">
          완성된 콘텐츠는 복사해서 직접 게시하시면 돼요. CREVENA가 회원님의 SNS 계정에 대신 게시하지는 않아요.
        </p>
      </section>

      {/* AI photo recommendation */}
      <section className="border-y border-zinc-200 bg-white">
        <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6">
          <h2 className="text-xl font-bold break-keep text-zinc-900 sm:text-2xl">사진 고르는 시간도 줄여보세요.</h2>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed break-keep text-zinc-600">
            여러 장의 사진을 분석해 콘텐츠에 사용할 사진과 순서를 AI가 추천합니다.
          </p>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed break-keep text-zinc-600">
            비슷한 사진을 비교하고, 제품·사용 모습·디테일 등 콘텐츠에 필요한 장면을 함께 살펴볼 수 있어요.
          </p>
          <p className="mt-5 text-xs text-zinc-400">AI 추천 결과는 직접 변경할 수 있습니다.</p>
        </div>
      </section>

      {/* No fabrication */}
      <section className="mx-auto w-full max-w-3xl px-4 py-16 text-center sm:px-6">
        <h2 className="text-xl font-bold break-keep text-zinc-900 sm:text-2xl">
          찍지 않은 사진,
          <br className="sm:hidden" /> 하지 않은 경험까지 만들지 않도록
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed break-keep text-zinc-600">
          CREVENA는 업로드한 사진 분석과 사용자가 입력한 실제 경험을 바탕으로 콘텐츠를 작성하도록 설계되어 있습니다.
        </p>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed break-keep text-zinc-600">
          AI가 작성한 결과는 발행 전 사용자가 직접 확인하고 수정할 수 있습니다.
        </p>
      </section>

      {/* Target users */}
      <section className="border-y border-zinc-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-center text-xl font-bold text-zinc-900 sm:text-2xl">이런 분께 잘 맞아요.</h2>
          <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {TARGETS.map((t) => (
              <div key={t.title} className="flex items-start gap-2 rounded-xl border border-zinc-200 bg-white p-4">
                <CheckIcon size={16} className="mt-0.5 shrink-0 text-brand-600" />
                <div>
                  <p className="text-sm font-semibold break-keep text-zinc-900">{t.title}</p>
                  <p className="mt-1 text-xs leading-relaxed break-keep text-zinc-500">“{t.quote}”</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Differentiation */}
      <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="mx-auto max-w-2xl text-center text-xl font-bold leading-snug break-keep text-zinc-900 sm:text-2xl">
          단순히 글 하나를 만드는 것보다, 협찬 하나를 끝내는 과정에 집중했습니다.
        </h2>
        <div className="mx-auto mt-8 grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2">
          <FlowCard title="일반 AI 글쓰기" steps={GENERIC_FLOW} />
          <FlowCard title="CREVENA" steps={CREVENA_FLOW} highlight />
        </div>
      </section>

      {/* Pricing preview — real PLAN_CONFIGS data, no invented numbers */}
      <section className="border-y border-zinc-200 bg-white">
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
                <p className="mt-3 text-xs break-keep text-zinc-500">{plan.recommendedFor}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="bg-brand-50">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 px-4 py-16 text-center sm:px-6">
          <h2 className="text-xl font-bold break-keep text-zinc-900 sm:text-2xl">
            다음 협찬 콘텐츠는
            <br className="sm:hidden" /> 조금 더 빠르게 준비해보세요.
          </h2>
          <p className="max-w-md text-sm leading-relaxed break-keep text-zinc-600">
            가이드와 촬영한 사진을 준비했다면 CREVENA에서 하나의 제작 흐름으로 시작해보세요.
          </p>
          <Link href="/login?mode=signup">
            <Button size="lg">
              무료로 시작하기 <ArrowRightIcon size={16} />
            </Button>
          </Link>
          <p className="text-xs text-zinc-500">FREE · {PLAN_CONFIGS.FREE.monthlyCreditLimit} credits</p>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}

// A vertical "input -> ... -> result" flow. Used for the plain-AI-writing vs
// CREVENA comparison; `highlight` only changes the styling.
function FlowCard({
  title,
  steps,
  highlight = false,
}: {
  title: string;
  steps: readonly string[];
  highlight?: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center rounded-xl border p-5 ${
        highlight ? "border-brand-300 bg-brand-50" : "border-zinc-200 bg-white"
      }`}
    >
      <p className={`text-sm font-bold ${highlight ? "text-brand-700" : "text-zinc-500"}`}>{title}</p>
      <ol className="mt-4 flex w-full flex-col items-center gap-1.5">
        {steps.map((step, i) => (
          <li key={step} className="flex w-full flex-col items-center gap-1.5">
            <span
              className={`w-full max-w-[220px] rounded-lg px-3 py-2 text-center text-sm font-medium ${
                highlight ? "bg-white text-brand-700" : "bg-zinc-100 text-zinc-600"
              }`}
            >
              {step}
            </span>
            {i < steps.length - 1 && (
              <ArrowRightIcon size={14} className={`rotate-90 ${highlight ? "text-brand-300" : "text-zinc-300"}`} />
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
