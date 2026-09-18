import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getPlanConfig, normalizePlanTier } from "@/lib/plans";
import { BillingActions } from "./BillingActions";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

const STATUS_LABELS: Record<string, string> = {
  NONE: "구독 없음",
  ACTIVE: "활성",
  PAST_DUE: "결제 지연 (재시도 예정)",
  CANCELED: "해지됨",
  EXPIRED: "만료됨",
};

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString("ko-KR") : "-";
}

function formatDateOnly(value: string) {
  return new Date(value).toLocaleDateString("ko-KR");
}

export default async function BillingSettingsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // RLS scopes every query below to this user's own row/rows automatically
  // — no other user's billing data can ever come back here.
  const { data: profile } = await supabase
    .from("users")
    .select(
      "plan_tier, subscription_status, next_billing_at, next_retry_at, last_payment_error_type, cancel_at_period_end, scheduled_plan",
    )
    .eq("id", user.id)
    .maybeSingle();

  const { data: payments } = await supabase
    .from("payment_events")
    .select("id, plan, amount, status, kind, created_at")
    .order("created_at", { ascending: false })
    .limit(20);

  const { data: refunds } = await supabase
    .from("payment_refunds")
    .select("id, refund_amount, reason, status, created_at")
    .order("created_at", { ascending: false })
    .limit(20);

  const planTier = normalizePlanTier(profile?.plan_tier);
  const plan = getPlanConfig(profile?.plan_tier);
  const status = profile?.subscription_status ?? "NONE";
  const cancelAtPeriodEnd = profile?.cancel_at_period_end ?? false;
  const scheduledPlan = profile?.scheduled_plan ?? null;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col">
      <Link href="/settings" className="text-sm text-zinc-500 hover:text-zinc-900">
        ← 설정
      </Link>

      <div className="mt-2">
        <PageHeader title="결제 내역" />
      </div>

      <Card className="mt-6">
        <h2 className="text-sm font-semibold text-zinc-900">현재 구독</h2>
        <div className="mt-3 flex flex-col gap-2 text-sm">
          <div className="flex justify-between border-b border-zinc-100 py-2">
            <span className="text-zinc-500">현재 플랜</span>
            <span className="font-medium text-zinc-900">{plan.label}</span>
          </div>
          <div className="flex justify-between border-b border-zinc-100 py-2">
            <span className="text-zinc-500">구독 상태</span>
            <span className="text-zinc-900">{STATUS_LABELS[status] ?? status}</span>
          </div>
          {status === "PAST_DUE" ? (
            <div className="flex justify-between border-b border-zinc-100 py-2">
              <span className="text-zinc-500">다음 재시도 예정일</span>
              <span className="text-zinc-900">{formatDate(profile?.next_retry_at ?? null)}</span>
            </div>
          ) : (
            <div className="flex justify-between border-b border-zinc-100 py-2">
              <span className="text-zinc-500">다음 결제 예정일</span>
              <span className="text-zinc-900">{formatDate(profile?.next_billing_at ?? null)}</span>
            </div>
          )}

          {cancelAtPeriodEnd && profile?.next_billing_at && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              {formatDateOnly(profile.next_billing_at)}까지 현재 플랜을 이용할 수 있으며 이후 FREE로 변경됩니다.
            </p>
          )}
          {!cancelAtPeriodEnd && scheduledPlan && profile?.next_billing_at && (
            <p className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
              {formatDateOnly(profile.next_billing_at)}부터 {getPlanConfig(scheduledPlan).label} 플랜으로 변경됩니다.
            </p>
          )}
        </div>

        <BillingActions
          planTier={planTier}
          subscriptionStatus={status}
          cancelAtPeriodEnd={cancelAtPeriodEnd}
          scheduledPlan={scheduledPlan}
        />
      </Card>

      <Card className="mt-6 p-0">
        <h2 className="px-4 pt-4 text-sm font-semibold text-zinc-900 sm:px-5 sm:pt-5">최근 결제 내역</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-sm whitespace-nowrap">
            <thead className="border-b border-zinc-200 text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-medium">날짜</th>
                <th className="px-4 py-3 font-medium">구분</th>
                <th className="px-4 py-3 font-medium">플랜</th>
                <th className="px-4 py-3 font-medium">금액</th>
                <th className="px-4 py-3 font-medium">결과</th>
              </tr>
            </thead>
            <tbody>
              {!payments || payments.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-4 text-center text-zinc-400">
                    결제 내역이 없습니다.
                  </td>
                </tr>
              ) : (
                payments.map((p) => (
                  <tr key={p.id} className="border-b border-zinc-100 last:border-0">
                    <td className="px-4 py-3 text-zinc-500">{formatDate(p.created_at)}</td>
                    <td className="px-4 py-3 text-zinc-600">{p.kind === "RECURRING" ? "정기결제" : "최초결제"}</td>
                    <td className="px-4 py-3 text-zinc-600">{p.plan}</td>
                    <td className="px-4 py-3 text-zinc-900">₩{p.amount.toLocaleString()}</td>
                    <td className="px-4 py-3">
                      {p.status === "PAID" ? (
                        <Badge tone="success">성공</Badge>
                      ) : p.status === "FAILED" ? (
                        <Badge tone="danger">실패</Badge>
                      ) : (
                        <Badge tone="warning">처리중</Badge>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {refunds && refunds.length > 0 && (
        <Card className="mt-6 p-0">
          <h2 className="px-4 pt-4 text-sm font-semibold text-zinc-900 sm:px-5 sm:pt-5">환불 내역</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[420px] text-left text-sm whitespace-nowrap">
              <thead className="border-b border-zinc-200 text-zinc-500">
                <tr>
                  <th className="px-4 py-3 font-medium">날짜</th>
                  <th className="px-4 py-3 font-medium">환불 금액</th>
                  <th className="px-4 py-3 font-medium">사유</th>
                  <th className="px-4 py-3 font-medium">상태</th>
                </tr>
              </thead>
              <tbody>
                {refunds.map((r) => (
                  <tr key={r.id} className="border-b border-zinc-100 last:border-0">
                    <td className="px-4 py-3 text-zinc-500">{formatDate(r.created_at)}</td>
                    <td className="px-4 py-3 text-zinc-900">₩{r.refund_amount.toLocaleString()}</td>
                    <td className="px-4 py-3 text-zinc-600">{r.reason || "-"}</td>
                    <td className="px-4 py-3">
                      {r.status === "SUCCEEDED" ? (
                        <Badge tone="success">완료</Badge>
                      ) : r.status === "FAILED" ? (
                        <Badge tone="danger">실패</Badge>
                      ) : (
                        <Badge tone="warning">처리중</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card className="mt-6">
        <h2 className="text-sm font-semibold text-zinc-900">환불이 필요하신가요?</h2>
        <p className="mt-1 text-sm text-zinc-500">
          환불은 직접 실행할 수 없으며, 고객센터로 문의해주시면 결제 내역을 확인 후 도와드립니다.
        </p>
      </Card>
    </div>
  );
}
