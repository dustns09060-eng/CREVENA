import { requireAdmin } from "@/lib/admin/guard";

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <p className="text-sm text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-zinc-900">{value.toLocaleString()}</p>
    </div>
  );
}

export default async function AdminDashboardPage() {
  const { supabase } = await requireAdmin();
  const { data: stats, error } = await supabase.rpc("admin_dashboard_stats");

  if (error || !stats) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-zinc-900">관리자 대시보드</h1>
        <p className="mt-4 text-sm text-red-600">통계를 불러오지 못했습니다: {error?.message}</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-zinc-900">관리자 대시보드</h1>

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
