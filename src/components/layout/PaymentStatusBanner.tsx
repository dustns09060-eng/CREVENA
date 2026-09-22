import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { paymentNoticeFor } from "@/lib/billing/payment-notice";

// Read-only, like UsageBadge: shows a notice when the member's recurring
// payment has failed (PAST_DUE) or has been given up on (EXPIRED). It reads
// only subscription_status / next_retry_at with the member's OWN session (both
// are on the column allow-list from migration 0016) and never writes anything.
// Nothing renders for everyone else, and any error just renders nothing — a
// broken banner must never break the page.
export async function PaymentStatusBanner() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile, error } = await supabase
    .from("users")
    .select("subscription_status, next_retry_at")
    .eq("id", user.id)
    .maybeSingle();
  if (error || !profile) return null;

  const notice = paymentNoticeFor(profile.subscription_status, profile.next_retry_at);
  if (!notice) return null;

  const tone =
    notice.tone === "danger"
      ? "border-red-200 bg-red-50 text-red-900"
      : "border-amber-200 bg-amber-50 text-amber-900";

  return (
    <div role="status" className={`mb-4 rounded-lg border px-4 py-3 text-sm ${tone}`}>
      <p className="font-semibold">{notice.title}</p>
      <p className="mt-1 leading-relaxed">{notice.body}</p>
      <Link href="/settings/billing" className="mt-2 inline-block font-medium underline underline-offset-2">
        결제 설정으로 이동
      </Link>
    </div>
  );
}
