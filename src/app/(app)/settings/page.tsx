import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { StyleManager } from "./StyleManager";
import { DangerZone } from "./DangerZone";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export default async function SettingsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: styles } = await supabase
    .from("creator_styles")
    .select("*")
    .order("created_at", { ascending: false });

  // RLS restricts this to the caller's own row. Only the three subscription
  // state columns are read — payment_subscription_id (the billing key) is
  // revoked from `authenticated` at the column level and is never needed
  // here; the deletion route re-checks all of this server-side anyway.
  const { data: profile } = await supabase
    .from("users")
    .select("plan_tier, subscription_status, cancel_at_period_end")
    .maybeSingle();

  const blockedBySubscription = Boolean(
    profile &&
      profile.plan_tier !== "FREE" &&
      ["ACTIVE", "PAST_DUE"].includes(profile.subscription_status) &&
      !profile.cancel_at_period_end,
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col">
      <PageHeader title="설정" />

      <Card className="mt-6">
        <h2 className="text-lg font-semibold text-zinc-900">결제</h2>
        <p className="mt-1 text-sm text-zinc-500">현재 플랜, 구독 상태, 결제 내역을 확인합니다.</p>
        <Link href="/settings/billing" className="mt-3 inline-block">
          <Button variant="secondary" size="sm">
            결제 내역 보기
          </Button>
        </Link>
      </Card>

      <Card className="mt-6">
        <h2 className="text-lg font-semibold text-zinc-900">내 글 스타일</h2>
        <p className="mt-1 text-sm text-zinc-500">
          평소 작성 스타일을 저장해두면 AI 콘텐츠 생성 시 참고합니다.
        </p>
        <div className="mt-4">
          <StyleManager styles={styles ?? []} />
        </div>
      </Card>

      <DangerZone blockedBySubscription={blockedBySubscription} />
    </div>
  );
}
