import { requireAdmin } from "@/lib/admin/guard";
import { RefundButton } from "../users/[id]/RefundButton";
import type { AdminOrphanedPaymentRow } from "@/types/database";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

// STEP51: payments left behind by a withdrawn member. Migration 0024 keeps
// payment_events/payment_refunds after account deletion (user_id SET NULL,
// not cascaded) so the transaction ledger survives — but until migration
// 0032 there was no admin screen that could even find one of these rows.
// admin_list_orphaned_refundable_payments() is is_admin()-gated and returns
// only PAID payments with a remaining refundable balance; there is no user
// identity left to show (user_id is NULL by definition here), so this page
// never attempts to recover or display an email/name — only that the
// account is gone.
export default async function AdminOrphanedPaymentsPage() {
  const { supabase } = await requireAdmin();

  const { data, error } = await supabase.rpc("admin_list_orphaned_refundable_payments");
  const payments = (data ?? []) as AdminOrphanedPaymentRow[];

  return (
    <div>
      <PageHeader
        title="탈퇴 회원 결제"
        description="회원탈퇴 후에도 거래 기록 보존을 위해 남아있는 결제 건입니다. 계정이 이미 삭제되어 이메일·이름 등 회원 정보는 표시할 수 없습니다. 환불해도 플랜·구독·크레딧·빌링키는 변경되지 않습니다(연결된 계정이 없습니다)."
      />

      <Card className="mt-6 p-0">
        {error ? (
          <p className="p-6 text-center text-sm text-red-600">목록을 불러오지 못했습니다.</p>
        ) : payments.length === 0 ? (
          <p className="p-6 text-center text-sm text-zinc-400">탈퇴 회원의 미환불 결제 건이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm whitespace-nowrap">
              <thead className="border-b border-zinc-200 text-zinc-500">
                <tr>
                  <th className="px-4 py-3 font-medium">결제일</th>
                  <th className="px-4 py-3 font-medium">종류</th>
                  <th className="px-4 py-3 font-medium">결제 식별자</th>
                  <th className="px-4 py-3 font-medium">원 결제 금액</th>
                  <th className="px-4 py-3 font-medium">이미 환불된 금액</th>
                  <th className="px-4 py-3 font-medium">환불 가능 잔액</th>
                  <th className="px-4 py-3 font-medium">환불</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className="border-b border-zinc-100 last:border-0">
                    <td className="px-4 py-3 text-zinc-500">{new Date(p.created_at).toLocaleString("ko-KR")}</td>
                    <td className="px-4 py-3 text-zinc-600">
                      <span className="mr-2">{p.kind === "RECURRING" ? "정기결제" : "최초결제"}</span>
                      <Badge tone="warning">탈퇴 회원</Badge>
                    </td>
                    <td className="px-4 py-3 text-zinc-500">{p.payment_id}</td>
                    <td className="px-4 py-3 text-zinc-900">₩{p.amount.toLocaleString()}</td>
                    <td className="px-4 py-3 text-zinc-600">₩{p.refunded_amount.toLocaleString()}</td>
                    <td className="px-4 py-3 text-zinc-900">₩{p.remaining_amount.toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <RefundButton paymentEventId={p.id} remaining={p.remaining_amount} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
