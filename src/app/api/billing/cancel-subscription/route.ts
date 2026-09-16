import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

// Schedules the subscription to end at the current period's next_billing_at
// instead of ending it immediately. Never touches plan_tier here — the
// actual downgrade to FREE happens in /api/cron/billing once that date
// arrives, matching "즉시 FREE로 강등하지 않는다".
export async function POST() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const service = createSupabaseServiceClient();
  const { data: profile } = await service
    .from("users")
    .select("plan_tier, subscription_status, cancel_at_period_end")
    .eq("id", user.id)
    .maybeSingle();

  if (
    !profile ||
    profile.plan_tier === "FREE" ||
    !["ACTIVE", "PAST_DUE"].includes(profile.subscription_status)
  ) {
    return NextResponse.json({ error: "취소할 수 있는 구독이 없습니다." }, { status: 400 });
  }
  if (profile.cancel_at_period_end) {
    return NextResponse.json({ error: "이미 취소가 예약되어 있습니다." }, { status: 400 });
  }

  const { error } = await service
    .from("users")
    .update({ cancel_at_period_end: true, scheduled_plan: "FREE" })
    .eq("id", user.id);

  if (error) {
    return NextResponse.json({ error: "취소 처리에 실패했습니다." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
