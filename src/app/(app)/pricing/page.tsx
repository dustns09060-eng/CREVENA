import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PLAN_CONFIGS, normalizePlanTier, type PlanConfig } from "@/lib/plans";
import { UpgradeButton } from "./UpgradeButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CheckIcon, XIcon } from "@/components/ui/Icon";

function formatPrice(krw: number) {
  return krw === 0 ? "무료" : `₩${krw.toLocaleString()}`;
}

function FeatureRow({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-zinc-600">{label}</span>
      {enabled ? (
        <span className="flex items-center gap-1 text-emerald-600">
          <CheckIcon size={13} /> 가능
        </span>
      ) : (
        <span className="flex items-center gap-1 text-zinc-300">
          <XIcon size={13} /> 미제공
        </span>
      )}
    </div>
  );
}

function limitText(n: number | null, unit: string) {
  return n === null ? "무제한" : `최대 ${n}${unit}`;
}

export default async function PricingPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let currentTier: string | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from("users")
      .select("plan_tier")
      .eq("id", user.id)
      .maybeSingle();
    currentTier = normalizePlanTier(profile?.plan_tier);
  }
  const userId = user?.id ?? null;

  const plans: PlanConfig[] = [PLAN_CONFIGS.FREE, PLAN_CONFIGS.BASIC, PLAN_CONFIGS.PRO];

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="요금제"
        description="AI 작업은 토큰 대신 이해하기 쉬운 크레딧으로 차감됩니다. 현재 결제는 테스트 환경에서만 동작합니다."
      />

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        {plans.map((plan) => {
          const isCurrent = currentTier === plan.tier;
          return (
            <div
              key={plan.tier}
              className={`flex flex-col rounded-xl border bg-white p-5 ${
                isCurrent ? "border-brand-600 ring-1 ring-brand-600" : "border-zinc-200"
              }`}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-zinc-900">{plan.label}</h2>
                {isCurrent && <Badge tone="brand">현재 플랜</Badge>}
              </div>

              <p className="mt-2 text-2xl font-bold text-zinc-900">
                {formatPrice(plan.monthlyPriceKrw)}
                {plan.monthlyPriceKrw > 0 && <span className="text-sm font-normal text-zinc-500">/월</span>}
              </p>

              <p className="mt-1 text-sm font-medium text-zinc-700">
                월 {plan.monthlyCreditLimit.toLocaleString()} AI 크레딧
              </p>

              <p className="mt-3 text-xs text-zinc-500">{plan.recommendedFor}</p>

              <ul className="mt-4 flex flex-col gap-1.5">
                {plan.highlights.map((h) => (
                  <li key={h} className="flex gap-1.5 text-sm text-zinc-700">
                    <span className="text-zinc-400">·</span>
                    {h}
                  </li>
                ))}
              </ul>

              <div className="mt-4 border-t border-zinc-100 pt-3">
                <FeatureRow label="사진 기반 블로그 작성" enabled={plan.photoBlogEnabled} />
                <FeatureRow label="AI 사진 분석" enabled={plan.photoAnalysisEnabled} />
                <FeatureRow label="문단 부분 재생성" enabled={plan.partialRegenerateEnabled} />
                <div className="flex items-center justify-between py-1.5 text-sm">
                  <span className="text-zinc-600">협찬 저장</span>
                  <span className="text-zinc-900">{limitText(plan.maxCollaborations, "건")}</span>
                </div>
                <div className="flex items-center justify-between py-1.5 text-sm">
                  <span className="text-zinc-600">콘텐츠 저장</span>
                  <span className="text-zinc-900">{limitText(plan.maxContents, "건")}</span>
                </div>
                <div className="flex items-center justify-between py-1.5 text-sm">
                  <span className="text-zinc-600">콘텐츠 보관</span>
                  <span className="text-zinc-900">{plan.contentRetention}</span>
                </div>
                <div className="flex items-center justify-between py-1.5 text-sm">
                  <span className="text-zinc-600">SNS 자동화(예정)</span>
                  <span className="text-zinc-900">{plan.snsAutomationScope}</span>
                </div>
              </div>

              <div className="mt-5">
                {isCurrent ? (
                  <Button variant="secondary" disabled className="w-full">
                    현재 이용 중
                  </Button>
                ) : (
                  <UpgradeButton
                    plan={plan.tier}
                    userId={userId}
                    label={plan.monthlyPriceKrw === 0 ? "무료로 시작" : "업그레이드"}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
