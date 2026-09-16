import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

// Undoes either a pending cancellation (cancel_at_period_end) or a pending
// downgrade (scheduled_plan) — whichever is set — as long as the current
// period hasn't actually ended yet. Only ever writes to the caller's own
// row (user.id from the session, never a client-supplied id).
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
    .select("cancel_at_period_end, scheduled_plan, next_billing_at")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || (!profile.cancel_at_period_end && !profile.scheduled_plan)) {
    return NextResponse.json({ error: "예약된 변경 사항이 없습니다." }, { status: 400 });
  }
  if (!profile.next_billing_at || new Date(profile.next_billing_at) <= new Date()) {
    return NextResponse.json({ error: "이미 반영 시점이 지나 철회할 수 없습니다." }, { status: 409 });
  }

  const { error } = await service
    .from("users")
    .update({ cancel_at_period_end: false, scheduled_plan: null })
    .eq("id", user.id);

  if (error) {
    return NextResponse.json({ error: "철회 처리에 실패했습니다." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
