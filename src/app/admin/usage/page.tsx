import { requireAdmin } from "@/lib/admin/guard";
import { computeUsageReport, type UsageCategory } from "@/lib/admin/usage-stats";
import { USD_TO_KRW_ESTIMATE } from "@/lib/ai/pricing";
import type { AdminUsageGroupedRow } from "@/types/database";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/States";
import { AlertTriangleIcon } from "@/components/ui/Icon";

const CATEGORY_LABELS: Record<UsageCategory, string> = {
  image_analysis: "사진 분석",
  blog_generation: "사진 기반 블로그 전체 작성",
  partial_regeneration: "문단 부분 재생성",
  text_generation: "텍스트 콘텐츠 생성(순서추천·가이드검사 포함)",
};

function usd(n: number) {
  return `$${n.toFixed(4)}`;
}
function krw(n: number) {
  return `₩${Math.round(n * USD_TO_KRW_ESTIMATE).toLocaleString()}`;
}

function StatCard({ label, usdValue }: { label: string; usdValue: number }) {
  return (
    <Card className="p-4">
      <p className="text-sm text-zinc-500">{label}</p>
      <p className="mt-1 text-xl font-bold text-zinc-900">{usd(usdValue)}</p>
      <p className="text-xs text-zinc-400">약 {krw(usdValue)} (환율 추정치)</p>
    </Card>
  );
}

export default async function AdminUsagePage() {
  const { supabase } = await requireAdmin();

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const todayStr = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    .toISOString()
    .slice(0, 10);

  const { data, error } = await supabase.rpc("admin_usage_grouped", {
    p_start: monthStart.toISOString(),
    p_end: monthEnd.toISOString(),
  });

  if (error) {
    return (
      <div>
        <PageHeader title="AI 사용량 / 비용" />
        <div className="mt-4">
          <ErrorState message={`데이터를 불러오지 못했습니다: ${error.message}`} />
        </div>
      </div>
    );
  }

  const rows = (data ?? []) as AdminUsageGroupedRow[];
  const report = computeUsageReport(rows, todayStr);

  return (
    <div>
      <PageHeader title="AI 사용량 / 비용" />
      {!report.overall.allVerified && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          <AlertTriangleIcon size={14} className="shrink-0" />
          일부 모델의 가격이 src/lib/ai/pricing.ts에 등록되어 있지 않아 해당 호출은 비용 $0으로 집계됩니다. 확인이
          필요합니다.
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="오늘 예상 AI 비용" usdValue={report.today.costUsd} />
        <StatCard label="이번 달 예상 AI 비용" usdValue={report.overall.costUsd} />
        <StatCard label="사용자 1명당 평균 AI 비용 (이번 달)" usdValue={report.avgCostPerUser} />
        <Card className="p-4">
          <p className="text-sm text-zinc-500">이번 달 총 사용 크레딧</p>
          <p className="mt-1 text-xl font-bold text-zinc-900">{report.overall.creditsUsed.toLocaleString()}</p>
          <p className="text-xs text-zinc-400">STEP24 이전 호출은 크레딧 값이 없어 0으로 집계</p>
        </Card>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="text-sm font-semibold text-zinc-900">기능별 AI 비용 (이번 달)</h2>
          <table className="mt-3 w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-zinc-500">
              <tr>
                <th className="py-2 font-medium">기능</th>
                <th className="py-2 font-medium">호출</th>
                <th className="py-2 font-medium">실패</th>
                <th className="py-2 font-medium">크레딧</th>
                <th className="py-2 font-medium">비용</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(CATEGORY_LABELS) as UsageCategory[]).map((cat) => {
                const t = report.byCategory.get(cat);
                if (!t) return null;
                return (
                  <tr key={cat} className="border-b border-zinc-100 last:border-0">
                    <td className="py-2 text-zinc-900">{CATEGORY_LABELS[cat]}</td>
                    <td className="py-2 text-zinc-700">{t.callCount}</td>
                    <td className="py-2 text-zinc-700">{t.failCount}</td>
                    <td className="py-2 text-zinc-700">{t.creditsUsed}</td>
                    <td className="py-2 text-zinc-700">{usd(t.costUsd)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        <Card>
          <h2 className="text-sm font-semibold text-zinc-900">모델별 AI 비용 (이번 달)</h2>
          <table className="mt-3 w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-zinc-500">
              <tr>
                <th className="py-2 font-medium">provider/model</th>
                <th className="py-2 font-medium">호출</th>
                <th className="py-2 font-medium">입력 토큰</th>
                <th className="py-2 font-medium">출력 토큰</th>
                <th className="py-2 font-medium">비용</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(report.byModel.entries()).map(([key, t]) => (
                <tr key={key} className="border-b border-zinc-100 last:border-0">
                  <td className="py-2 text-zinc-900">{key}</td>
                  <td className="py-2 text-zinc-700">{t.callCount}</td>
                  <td className="py-2 text-zinc-700">{t.inputTokens.toLocaleString()}</td>
                  <td className="py-2 text-zinc-700">{t.outputTokens.toLocaleString()}</td>
                  <td className="py-2 text-zinc-700">{usd(t.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <Card className="mt-6 p-0">
        <h2 className="px-4 pt-4 text-sm font-semibold text-zinc-900 sm:px-5 sm:pt-5">
          비용 상위 사용자 (이번 달, ADMIN 전용)
        </h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[600px] text-left text-sm whitespace-nowrap">
            <thead className="border-b border-zinc-200 text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-medium">이메일</th>
                <th className="px-4 py-3 font-medium">호출 수</th>
                <th className="px-4 py-3 font-medium">실패</th>
                <th className="px-4 py-3 font-medium">입력 토큰</th>
                <th className="px-4 py-3 font-medium">출력 토큰</th>
                <th className="px-4 py-3 font-medium">크레딧</th>
                <th className="px-4 py-3 font-medium">예상 비용</th>
              </tr>
            </thead>
            <tbody>
              {report.topUsers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-4 text-center text-zinc-400">
                    이번 달 AI 호출 기록이 없습니다.
                  </td>
                </tr>
              ) : (
                report.topUsers.map((u) => (
                  <tr key={u.userId} className="border-b border-zinc-100 last:border-0">
                    <td className="px-4 py-3 text-zinc-900">{u.email}</td>
                    <td className="px-4 py-3 text-zinc-700">{u.callCount}</td>
                    <td className="px-4 py-3 text-zinc-700">{u.failCount}</td>
                    <td className="px-4 py-3 text-zinc-700">{u.inputTokens.toLocaleString()}</td>
                    <td className="px-4 py-3 text-zinc-700">{u.outputTokens.toLocaleString()}</td>
                    <td className="px-4 py-3 text-zinc-700">{u.creditsUsed}</td>
                    <td className="px-4 py-3 font-medium text-zinc-900">{usd(u.costUsd)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
