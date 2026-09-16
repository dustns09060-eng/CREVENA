import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

// Only PRO -> BASIC is supported here (per this step's scope). Going to
// FREE is a cancellation (see /api/billing/cancel-subscription), not a
// downgrade. The target plan is validated against a fixed allow-list —
// never trusted beyond that — and the CURRENT plan is re-read from the DB,
// never taken from the request body.
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const targetPlan = body?.targetPlan;
  if (targetPlan !== "BASIC") {
    return NextResponse.json({ error: "지원하지 않는 플랜 변경입니다." }, { status: 400 });
  }

  const service = createSupabaseServiceClient();
  const { data: profile } = await service
    .from("users")
    .select("plan_tier, subscription_status, cancel_at_period_end")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || profile.plan_tier !== "PRO" || !["ACTIVE", "PAST_DUE"].includes(profile.subscription_status)) {
    return NextResponse.json({ error: "다운그레이드할 수 없는 상태입니다." }, { status: 400 });
  }
  if (profile.cancel_at_period_end) {
    return NextResponse.json({ error: "구독 취소가 예약되어 있어 다운그레이드할 수 없습니다." }, { status: 400 });
  }

  const { error } = await service
    .from("users")
    .update({ scheduled_plan: "BASIC" })
    .eq("id", user.id);

  if (error) {
    return NextResponse.json({ error: "다운그레이드 예약에 실패했습니다." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
