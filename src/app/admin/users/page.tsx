import Link from "next/link";
import { requireAdmin } from "@/lib/admin/guard";
import { getAiLimitsForPlan } from "@/lib/ai/plan-limits";
import type { AdminUserListRow } from "@/types/database";

const PLAN_FILTERS = ["FREE", "BASIC", "PRO"] as const;
const ACTIVE_FILTERS = ["ACTIVE", "INACTIVE"] as const;

function buildQuery(overrides: Record<string, string>, current: Record<string, string>) {
  const next = { ...current, ...overrides };
  const usp = new URLSearchParams();
  Object.entries(next).forEach(([k, v]) => {
    if (v) usp.set(k, v);
  });
  const qs = usp.toString();
  return qs ? `?${qs}` : "";
}

function isNeverActive(lastActiveAt: string) {
  return new Date(lastActiveAt).getTime() <= 0;
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; plan?: string; active?: string }>;
}) {
  const { supabase } = await requireAdmin();
  const params = await searchParams;
  const q = (params.q ?? "").trim();
  const plan = params.plan ?? "";
  const active = params.active ?? "";

  const { data: users, error } = await supabase.rpc("admin_list_users", {
    p_search: q || null,
    p_plan: plan || null,
    p_active: active || null,
  });

  const rows = (users ?? []) as AdminUserListRow[];

  return (
    <div>
      <h1 className="text-2xl font-bold text-zinc-900">사용자 관리</h1>

      <form className="mt-4 flex flex-wrap gap-2" action="">
        {plan && <input type="hidden" name="plan" value={plan} />}
        {active && <input type="hidden" name="active" value={active} />}
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="이메일 검색"
          className="w-64 rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-900"
        />
        <button type="submit" className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white">
          검색
        </button>
      </form>

      <div className="mt-3 flex flex-wrap gap-1">
        <Link
          href={`/admin/users${buildQuery({ plan: "" }, { q, plan, active })}`}
          className={`rounded-full px-3 py-1 text-sm font-medium ${!plan ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"}`}
        >
          전체 플랜
        </Link>
        {PLAN_FILTERS.map((p) => (
          <Link
            key={p}
            href={`/admin/users${buildQuery({ plan: p }, { q, plan, active })}`}
            className={`rounded-full px-3 py-1 text-sm font-medium ${plan === p ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"}`}
          >
            {p}
          </Link>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        <Link
          href={`/admin/users${buildQuery({ active: "" }, { q, plan, active })}`}
          className={`rounded-full px-3 py-1 text-sm font-medium ${!active ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"}`}
        >
          전체 상태
        </Link>
        {ACTIVE_FILTERS.map((a) => (
          <Link
            key={a}
            href={`/admin/users${buildQuery({ active: a }, { q, plan, active })}`}
            className={`rounded-full px-3 py-1 text-sm font-medium ${active === a ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"}`}
          >
            {a === "ACTIVE" ? "활성(30일)" : "비활성"}
          </Link>
        ))}
      </div>

      <div className="mt-6 overflow-x-auto rounded-xl border border-zinc-200 bg-white">
        {error ? (
          <p className="p-6 text-sm text-red-600">목록을 불러오지 못했습니다: {error.message}</p>
        ) : rows.length === 0 ? (
          <p className="p-6 text-sm text-zinc-500">조건에 맞는 사용자가 없습니다.</p>
        ) : (
          <table className="w-full min-w-[860px] text-left text-sm whitespace-nowrap">
            <thead className="border-b border-zinc-200 text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-medium">이메일</th>
                <th className="px-4 py-3 font-medium">가입일</th>
                <th className="px-4 py-3 font-medium">최근 활동일</th>
                <th className="px-4 py-3 font-medium">플랜</th>
                <th className="px-4 py-3 font-medium">권한</th>
                <th className="px-4 py-3 font-medium">이번달 사용 크레딧</th>
                <th className="px-4 py-3 font-medium">AI 호출 수</th>
                <th className="px-4 py-3 font-medium">사진 분석</th>
                <th className="px-4 py-3 font-medium">블로그 생성</th>
                <th className="px-4 py-3 font-medium">실패 호출</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => {
                const limit = getAiLimitsForPlan(u.plan_tier).monthlyCreditLimit;
                const ratio = limit > 0 ? u.credits_used_month / limit : 0;
                const heavy = ratio >= 0.8;
                return (
                  <tr key={u.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                    <td className="p-0">
                      <Link href={`/admin/users/${u.id}`} className="block px-4 py-3 text-zinc-900 underline-offset-2 hover:underline">
                        {u.email}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-zinc-500">{new Date(u.created_at).toLocaleDateString("ko-KR")}</td>
                    <td className="px-4 py-3 text-zinc-500">
                      {isNeverActive(u.last_active_at) ? "-" : new Date(u.last_active_at).toLocaleDateString("ko-KR")}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700">
                        {u.plan_tier}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {u.role === "ADMIN" ? (
                        <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
                          ADMIN
                        </span>
                      ) : (
                        <span className="text-zinc-500">USER</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={heavy ? "font-semibold text-amber-600" : "text-zinc-700"}>
                        {u.credits_used_month} / {limit}
                        {heavy ? " ⚠" : ""}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-500">{u.ai_calls_month}</td>
                    <td className="px-4 py-3 text-zinc-700">{u.photo_analysis_month}</td>
                    <td className="px-4 py-3 text-zinc-700">{u.blog_generation_month}</td>
                    <td className="px-4 py-3">
                      <span className={u.fail_count_month >= 5 ? "font-semibold text-red-600" : "text-zinc-700"}>
                        {u.fail_count_month}
                        {u.fail_count_month >= 5 ? " ⚠" : ""}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
