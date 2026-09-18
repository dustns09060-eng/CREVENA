import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

// STEP45.1: 회원탈퇴 (account deletion).
//
// Ownership is derived ENTIRELY server-side: the only identity this route
// trusts is `supabase.auth.getUser()` from the caller's own session cookie.
// No target user id, and no storage path list, is ever accepted from the
// client — a client-supplied path list would let any logged-in user delete
// another user's objects, since the service-role client bypasses the
// storage RLS policies that normally scope `${uid}/...` to its owner.
//
// DB rows need no explicit deletes: every user-owned table declares
// `references public.users(id) on delete cascade`, and `public.users.id`
// itself is `references auth.users(id) on delete cascade`, so removing the
// auth user cascades collaborations / contents / photos / videos /
// schedules / guides / creator_styles / photo_presets / ai_usage_logs /
// ai_usage_quotas / ai_usage_reservations. Storage objects do NOT cascade
// (storage.objects has no FK to public.users), which is exactly why they
// are removed here first.
//
// STEP45.2 — payment_events / payment_refunds are the deliberate
// exception. Migration 0024 changes their user_id FK (and
// payment_refunds.requested_by) from `on delete cascade` to
// `on delete set null`, so the transaction/refund ledger SURVIVES a
// withdrawal with its user pointer cleared, instead of being erased with
// the account. This route must therefore never DELETE from those two
// tables itself — it does not today, and must not start: the retention is
// enforced entirely by the FK, and an explicit delete here would silently
// defeat it. No PII is copied into those tables to compensate.

const PHOTO_BUCKET = "collaboration-photos";
const VIDEO_BUCKET = "collaboration-videos";
const REMOVE_CHUNK = 100;

// Diagnostic only: a user-id fragment plus operation/category, never the
// full id, an email, a storage path, or a raw provider/Supabase message.
function logFailure(userId: string, operation: string, category: string) {
  console.error(`[account-delete] user=${userId.slice(0, 8)} op=${operation} result=${category}`);
}

// Walks the caller's own `${userId}/` prefix in a bucket and returns every
// object key under it. Supabase Storage `list()` is per-directory, not
// recursive, so photos/videos (stored at `${userId}/${collaborationId}/...`)
// need one pass over the collaboration folders. This runs IN ADDITION to
// the DB-derived paths so that an object whose DB row was already deleted,
// or an upload that failed to record a row, still gets cleaned up.
async function listOwnedObjects(
  service: ReturnType<typeof createSupabaseServiceClient>,
  bucket: string,
  userId: string,
): Promise<string[]> {
  const found: string[] = [];
  const { data: topLevel, error } = await service.storage.from(bucket).list(userId, { limit: 1000 });
  if (error) throw error;

  for (const entry of topLevel ?? []) {
    // A row with no `id` is a synthetic folder placeholder, not an object.
    if (entry.id) {
      found.push(`${userId}/${entry.name}`);
      continue;
    }
    const prefix = `${userId}/${entry.name}`;
    const { data: nested, error: nestedError } = await service.storage
      .from(bucket)
      .list(prefix, { limit: 1000 });
    if (nestedError) throw nestedError;
    for (const child of nested ?? []) {
      if (child.id) found.push(`${prefix}/${child.name}`);
    }
  }
  return found;
}

async function removeAll(
  service: ReturnType<typeof createSupabaseServiceClient>,
  bucket: string,
  paths: string[],
) {
  for (let i = 0; i < paths.length; i += REMOVE_CHUNK) {
    const { error } = await service.storage.from(bucket).remove(paths.slice(i, i + REMOVE_CHUNK));
    if (error) throw error;
  }
}

export async function POST() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const service = createSupabaseServiceClient();

  const { data: profile, error: profileError } = await service
    .from("users")
    .select("plan_tier, subscription_status, cancel_at_period_end")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile) {
    logFailure(user.id, "load_profile", "PROFILE_LOOKUP_FAILED");
    return NextResponse.json(
      { error: "계정 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 },
    );
  }

  // Active paid subscription guard. A live billing key must never be left
  // behind by an account deletion, and this step deliberately builds no new
  // payment logic: the user must first go through the EXISTING cancellation
  // flow (/api/billing/cancel-subscription, surfaced in /settings/billing).
  // Nothing here calls PortOne, cancels, or refunds anything.
  const hasLiveSubscription =
    profile.plan_tier !== "FREE" &&
    ["ACTIVE", "PAST_DUE"].includes(profile.subscription_status) &&
    !profile.cancel_at_period_end;

  if (hasLiveSubscription) {
    return NextResponse.json(
      {
        error: "구독 해지 후 회원탈퇴가 가능합니다.",
        code: "SUBSCRIPTION_ACTIVE",
      },
      { status: 409 },
    );
  }

  // Ownership derived from DB rows the user owns, union the user's own
  // storage prefix. Both sources are server-side; neither comes from input.
  const { data: photos, error: photoError } = await service
    .from("collaboration_photos")
    .select("storage_path, thumbnail_path, edited_storage_path, edited_thumbnail_path")
    .eq("user_id", user.id);
  const { data: videos, error: videoError } = await service
    .from("collaboration_videos")
    .select("storage_path")
    .eq("user_id", user.id);

  if (photoError || videoError) {
    logFailure(user.id, "load_owned_paths", "OWNED_PATH_LOOKUP_FAILED");
    return NextResponse.json(
      { error: "삭제할 파일 목록을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 },
    );
  }

  const photoPaths = new Set<string>();
  for (const row of photos ?? []) {
    for (const path of [
      row.storage_path,
      row.thumbnail_path,
      row.edited_storage_path,
      row.edited_thumbnail_path,
    ]) {
      // Belt-and-braces: a stored path must still sit under this user's own
      // prefix before the service-role client is pointed at it.
      if (path && path.startsWith(`${user.id}/`)) photoPaths.add(path);
    }
  }
  const videoPaths = new Set<string>();
  for (const row of videos ?? []) {
    if (row.storage_path && row.storage_path.startsWith(`${user.id}/`)) {
      videoPaths.add(row.storage_path);
    }
  }

  try {
    for (const path of await listOwnedObjects(service, PHOTO_BUCKET, user.id)) photoPaths.add(path);
    for (const path of await listOwnedObjects(service, VIDEO_BUCKET, user.id)) videoPaths.add(path);

    await removeAll(service, PHOTO_BUCKET, [...photoPaths]);
    await removeAll(service, VIDEO_BUCKET, [...videoPaths]);
  } catch {
    // Storage removal failed: stop BEFORE deleting the auth user, so the
    // account still exists and the user can retry, rather than being left
    // signed out with undeletable orphan files.
    logFailure(user.id, "storage_remove", "STORAGE_DELETE_FAILED");
    return NextResponse.json(
      { error: "업로드한 파일을 삭제하지 못해 탈퇴를 완료하지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 },
    );
  }

  // Cascades every public table listed in the header comment.
  const { error: deleteError } = await service.auth.admin.deleteUser(user.id);
  if (deleteError) {
    logFailure(user.id, "auth_delete", "AUTH_DELETE_FAILED");
    return NextResponse.json(
      { error: "계정 삭제에 실패했습니다. 문제가 계속되면 dustns0906@kakao.com으로 문의해 주세요." },
      { status: 500 },
    );
  }

  // Best-effort cookie clear. The session is already dead server-side once
  // the auth user is gone, so a failure here is not reported as a failed
  // deletion — the client signs out and redirects regardless.
  await supabase.auth.signOut().catch(() => undefined);

  return NextResponse.json({ ok: true });
}
