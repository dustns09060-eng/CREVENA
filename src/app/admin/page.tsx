import { requireAdmin } from "@/lib/admin/guard";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/States";

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-4">
      <p className="text-sm text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-zinc-900">{value.toLocaleString()}</p>
    </Card>
  );
}

export default async function AdminDashboardPage() {
  const { supabase } = await requireAdmin();
  const { data: stats, error } = await supabase.rpc("admin_dashboard_stats");

  if (error || !stats) {
    return (
      <div>
        <PageHeader title="관리자 대시보드" />
        <div className="mt-4">
          <ErrorState message={`통계를 불러오지 못했습니다: ${error?.message}`} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="관리자 대시보드" />

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="전체 회원 수" value={stats.total_users} />
        <StatCard label="최근 30일 활성 회원" value={stats.active_30d} />
        <StatCard label="FREE 회원" value={stats.free_users} />
        <StatCard label="BASIC 회원" value={stats.basic_users} />
        <StatCard label="PRO 회원" value={stats.pro_users} />
        <StatCard label="오늘 AI 호출 수" value={stats.ai_calls_today} />
        <StatCard label="이번 달 AI 호출 수" value={stats.ai_calls_month} />
        <StatCard label="이번 달 사진 분석 수" value={stats.photo_analysis_month} />
        <StatCard label="이번 달 블로그 생성 수" value={stats.blog_generation_month} />
        <StatCard label="이번 달 AI 호출 실패 수" value={stats.ai_failures_month} />
      </div>
    </div>
  );
}
