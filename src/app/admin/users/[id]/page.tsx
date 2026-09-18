import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin/guard";
import { getAiLimitsForPlan } from "@/lib/ai/plan-limits";
import { RefundButton } from "./RefundButton";
import type { AdminUserDetail } from "@/types/database";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

const FEATURE_LABELS: Record<string, string> = {
  TEXT_GENERATION: "텍스트 생성",
  VISION_ANALYSIS: "사진 분석",
};

const OPERATION_LABELS: Record<string, string> = {
  BLOG_WRITE: "블로그 전체 작성",
  PARAGRAPH_REGENERATE: "문단 부분 재생성",
  ORDER_SUGGEST: "사진 순서 추천",
  GUIDE_CHECK: "가이드 검사",
  CONTENT_GENERATE: "SNS 콘텐츠 생성",
  PHOTO_ANALYSIS: "사진 분석",
};

const SUBSCRIPTION_STATUS_LABELS: Record<string, string> = {
  NONE: "구독 없음",
  ACTIVE: "활성",
  PAST_DUE: "결제 지연",
  CANCELED: "해지됨",
  EXPIRED: "만료됨",
};

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-zinc-100 py-2 last:border-0 sm:flex-row sm:gap-4">
      <span className="w-40 shrink-0 text-sm text-zinc-500">{label}</span>
      <span className="text-sm text-zinc-900">{value ?? "-"}</span>
    </div>
  );
}

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { supabase } = await requireAdmin();
  const { id } = await params;

  const { data, error } = await supabase.rpc("admin_user_detail", { p_user_id: id });
  if (error || !data) {
    notFound();
  }
  const detail = data as AdminUserDetail;

  const limit = getAiLimitsForPlan(detail.plan_tier).monthlyCreditLimit;
  const ratio = limit > 0 ? detail.credits_used_month / limit : 0;
  const heavy = ratio >= 0.8;
  const recentFailCount = detail.failed_logs.length;
  const failHeavy = recentFailCount >= 5;

  const refundedByPaymentEvent = new Map<string, number>();
  for (const r of detail.recent_refunds) {
    if (r.status !== "SUCCEEDED") continue;
    refundedByPaymentEvent.set(r.payment_event_id, (refundedByPaymentEvent.get(r.payment_event_id) ?? 0) + r.refund_amount);
  }

  return (
    <div>
      <Link href="/admin/users" className="text-sm text-zinc-500 hover:text-zinc-900">
        ← 사용자 목록
      </Link>

      <div className="mt-2">
        <PageHeader title={detail.email} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="text-sm font-semibold text-zinc-900">기본 정보</h2>
          <div className="mt-3 flex flex-col">
            <InfoRow label="이메일" value={detail.email} />
            <InfoRow label="표시 이름" value={detail.display_name} />
            <InfoRow label="플랜" value={<Badge>{detail.plan_tier}</Badge>} />
            <InfoRow
              label="권한"
              value={detail.role === "ADMIN" ? <Badge tone="brand">ADMIN</Badge> : "USER"}
            />
            <InfoRow label="가입일" value={new Date(detail.created_at).toLocaleString("ko-KR")} />
            <InfoRow
              label="최근 로그인"
              value={detail.last_sign_in_at ? new Date(detail.last_sign_in_at).toLocaleString("ko-KR") : "기록 없음"}
            />
          </div>
        </Card>

        <Card>
          <h2 className="text-sm font-semibold text-zinc-900">구독 상태</h2>
          <div className="mt-3 flex flex-col">
            <InfoRow
              label="상태"
              value={SUBSCRIPTION_STATUS_LABELS[detail.subscription_status] ?? detail.subscription_status}
            />
            <InfoRow
              label="시작일"
              value={detail.subscription_started_at ? new Date(detail.subscription_started_at).toLocaleString("ko-KR") : null}
            />
            <InfoRow
              label="만료일"
              value={detail.subscription_expires_at ? new Date(detail.subscription_expires_at).toLocaleString("ko-KR") : null}
            />
            <InfoRow
              label="다음 결제일"
              value={detail.next_billing_at ? new Date(detail.next_billing_at).toLocaleString("ko-KR") : null}
            />
            <InfoRow
              label="기간 종료 시 해지 예약"
              value={detail.cancel_at_period_end ? "예정됨" : "아니오"}
            />
            <InfoRow label="예약된 플랜 변경" value={detail.scheduled_plan} />
            <InfoRow label="결제 제공자" value={detail.payment_provider} />
            <InfoRow label="결제 고객 ID" value={detail.payment_customer_id} />
            <InfoRow label="빌링키 등록" value={detail.has_billing_key ? "등록됨" : "미등록"} />
            <InfoRow label="연속 결제 실패 횟수" value={detail.retry_count} />
            <InfoRow
              label="다음 재시도 예정"
              value={detail.next_retry_at ? new Date(detail.next_retry_at).toLocaleString("ko-KR") : null}
            />
            <InfoRow
              label="마지막 결제 실패"
              value={
                detail.last_payment_failed_at
                  ? `${new Date(detail.last_payment_failed_at).toLocaleString("ko-KR")}${detail.last_payment_error_type ? ` (${detail.last_payment_error_type})` : ""}`
                  : null
              }
            />
          </div>
        </Card>

        <Card>
          <h2 className="text-sm font-semibold text-zinc-900">최근 결제 내역 (최대 10건)</h2>
          <div className="mt-3 flex flex-col">
            {detail.recent_payments.length === 0 ? (
              <p className="py-4 text-center text-sm text-zinc-400">결제 이력이 없습니다.</p>
            ) : (
              detail.recent_payments.map((p) => {
                const refunded = refundedByPaymentEvent.get(p.id) ?? 0;
                const remaining = p.amount - refunded;
                return (
                  <div
                    key={p.id}
                    className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 py-2 text-sm last:border-0"
                  >
                    <span className="text-zinc-500">{new Date(p.created_at).toLocaleString("ko-KR")}</span>
                    <span className="text-zinc-600">{p.kind === "RECURRING" ? "정기결제" : "최초결제"} · {p.plan}</span>
                    <span className="text-zinc-900">₩{p.amount.toLocaleString()}</span>
                    {p.status === "PAID" ? (
                      <Badge tone="success">성공</Badge>
                    ) : p.status === "FAILED" ? (
                      <Badge tone="danger">실패{p.error_type ? ` (${p.error_type})` : ""}</Badge>
                    ) : (
                      <Badge tone="warning">처리중</Badge>
                    )}
                    {p.status === "PAID" && <RefundButton paymentEventId={p.id} remaining={remaining} />}
                  </div>
                );
              })
            )}
          </div>
        </Card>

        <Card>
          <h2 className="text-sm font-semibold text-zinc-900">이번 달 AI 사용량</h2>
          <div className="mt-3 flex flex-col">
            <InfoRow
              label="사용 크레딧"
              value={
                <span className={heavy ? "font-semibold text-amber-600" : ""}>
                  {detail.credits_used_month} / {limit}
                  {heavy ? "  ⚠ 80% 이상 사용" : ""}
                </span>
              }
            />
            <InfoRow label="AI 호출 수" value={detail.ai_calls_month} />
            <InfoRow label="사진 분석 장수" value={detail.photo_analysis_month} />
            <InfoRow label="블로그 생성 횟수" value={detail.blog_generation_month} />
            <InfoRow
              label="최근 실패 호출(최대 20건)"
              value={
                <span className={failHeavy ? "font-semibold text-red-600" : ""}>
                  {recentFailCount}건{failHeavy ? "  ⚠ 실패 비정상적으로 많음" : ""}
                </span>
              }
            />
          </div>
        </Card>
      </div>

      {detail.recent_refunds.length > 0 && (
        <Card className="mt-6">
          <h2 className="text-sm font-semibold text-zinc-900">환불 내역 (최대 10건)</h2>
          <div className="mt-3 flex flex-col">
            {detail.recent_refunds.map((r) => (
              <div key={r.id} className="flex items-center justify-between border-b border-zinc-100 py-2 text-sm last:border-0">
                <span className="text-zinc-500">{new Date(r.created_at).toLocaleString("ko-KR")}</span>
                <span className="text-zinc-900">₩{r.refund_amount.toLocaleString()}</span>
                <span className="text-zinc-600">{r.reason || "-"}</span>
                {r.status === "SUCCEEDED" ? (
                  <Badge tone="success">완료</Badge>
                ) : r.status === "FAILED" ? (
                  <Badge tone="danger">실패</Badge>
                ) : (
                  <Badge tone="warning">처리중</Badge>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="mt-6 p-0">
        <h2 className="px-4 pt-4 text-sm font-semibold text-zinc-900 sm:px-5 sm:pt-5">최근 AI 호출 (최대 30건)</h2>
        <p className="px-4 pt-1 text-xs text-zinc-500 sm:px-5">
          운영 메타데이터만 표시합니다. 실제 협찬 본문·메모·사진 내용은 표시하지 않습니다.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm whitespace-nowrap">
            <thead className="border-b border-zinc-200 text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-medium">시각</th>
                <th className="px-4 py-3 font-medium">기능</th>
                <th className="px-4 py-3 font-medium">작업</th>
                <th className="px-4 py-3 font-medium">상태</th>
                <th className="px-4 py-3 font-medium">모델</th>
                <th className="px-4 py-3 font-medium">입력 토큰</th>
                <th className="px-4 py-3 font-medium">출력 토큰</th>
                <th className="px-4 py-3 font-medium">크레딧</th>
              </tr>
            </thead>
            <tbody>
              {detail.recent_logs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-4 text-center text-zinc-400">
                    호출 기록이 없습니다.
                  </td>
                </tr>
              ) : (
                detail.recent_logs.map((log) => (
                  <tr key={log.id} className="border-b border-zinc-100 last:border-0">
                    <td className="px-4 py-3 text-zinc-500">{new Date(log.created_at).toLocaleString("ko-KR")}</td>
                    <td className="px-4 py-3">{FEATURE_LABELS[log.feature] ?? log.feature}</td>
                    <td className="px-4 py-3 text-zinc-600">
                      {log.operation ? OPERATION_LABELS[log.operation] ?? log.operation : "-"}
                    </td>
                    <td className="px-4 py-3">
                      {log.status === "success" ? (
                        <Badge tone="success">성공</Badge>
                      ) : (
                        <Badge tone="danger">실패{log.error_type ? ` (${log.error_type})` : ""}</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-500">{log.model ?? "-"}</td>
                    <td className="px-4 py-3 text-zinc-500">{log.input_tokens ?? "-"}</td>
                    <td className="px-4 py-3 text-zinc-500">{log.output_tokens ?? "-"}</td>
                    <td className="px-4 py-3 text-zinc-500">{log.credits_used ?? "-"}</td>
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
