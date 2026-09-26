import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { detectImageMimeType, extensionForMimeType } from "./validate-image";

const BUCKET = "product-shorts-media";

type Client = SupabaseClient<Database>;

export type UploadPhotoResult = { id: string } | { error: string };

// The ONLY place a Product Shorts photo is uploaded. Ownership, MIME, and
// Storage path are all decided HERE, server-side — never trusted from the
// caller beyond the raw file bytes and the projectId to attach to.
//
// Order (matches this repo's established safe-delete/safe-write pattern —
// see src/lib/photos/delete-photo.ts and src/app/api/billing/*):
//  1. Re-derive project ownership from the DB under the CALLER's own
//     session (RLS-scoped select) — a projectId that isn't the caller's own
//     simply matches no row, same "silent no-op, not an error" posture used
//     elsewhere in this codebase for a foreign id.
//  2. Sniff the real image type from the file's magic bytes — a claimed
//     Content-Type or a ".jpg" extension is never trusted.
//  3. Build the Storage path SERVER-SIDE: `${userId}/${projectId}/${uuid}.${ext}`
//     — the caller never supplies or influences the path.
//  4. Upload original + thumbnail to Storage.
//  5. Insert the product_shorts_media row. If this fails, the just-uploaded
//     Storage objects are removed immediately (rollback) — a failed DB
//     write must never leave orphaned Storage objects with nothing pointing
//     at them.
export async function uploadProductShortsPhoto(
  supabase: Client,
  userId: string,
  input: {
    projectId: string;
    photoBytes: Uint8Array;
    thumbnailBytes: Uint8Array;
    originalFilename?: string | null;
  },
): Promise<UploadPhotoResult> {
  // Step 1: ownership — RLS already scopes this select to the caller's own
  // rows (user_id = auth.uid()), so a foreign projectId returns no row.
  const { data: project, error: projectError } = await supabase
    .from("product_shorts_projects")
    .select("id, user_id")
    .eq("id", input.projectId)
    .maybeSingle();

  if (projectError) return { error: "프로젝트 정보를 확인하지 못했어요." };
  if (!project || project.user_id !== userId) {
    // Either genuinely not found, or (defensively — should be unreachable
    // given RLS) not owned by this caller. Same message either way: never
    // reveal whether a foreign projectId exists.
    return { error: "프로젝트를 찾을 수 없어요." };
  }

  // Step 2: real image-type sniffing.
  const photoMime = detectImageMimeType(input.photoBytes);
  if (!photoMime) return { error: "지원하지 않는 이미지 형식이에요. JPG, PNG, WEBP만 업로드할 수 있어요." };
  const thumbMime = detectImageMimeType(input.thumbnailBytes);
  if (!thumbMime) return { error: "지원하지 않는 이미지 형식이에요. JPG, PNG, WEBP만 업로드할 수 있어요." };

  // Step 3: server-generated path — the caller has no say in this at all.
  const uuid = crypto.randomUUID();
  const ext = extensionForMimeType(photoMime);
  const photoPath = `${userId}/${input.projectId}/${uuid}.${ext}`;
  const thumbPath = `${userId}/${input.projectId}/${uuid}_thumb.${extensionForMimeType(thumbMime)}`;

  // Step 4: Storage upload.
  const { error: photoUploadError } = await supabase.storage
    .from(BUCKET)
    .upload(photoPath, input.photoBytes, { contentType: photoMime });
  if (photoUploadError) return { error: "사진 업로드에 실패했어요. 잠시 후 다시 시도해주세요." };

  const { error: thumbUploadError } = await supabase.storage
    .from(BUCKET)
    .upload(thumbPath, input.thumbnailBytes, { contentType: thumbMime });
  if (thumbUploadError) {
    // Roll back the original — don't leave a half-uploaded pair.
    await supabase.storage.from(BUCKET).remove([photoPath]);
    return { error: "사진 업로드에 실패했어요. 잠시 후 다시 시도해주세요." };
  }

  // Step 5: DB row. On failure, remove what was just uploaded — a failed
  // insert must never leave an unreferenced Storage object behind.
  const { data: mediaRow, error: insertError } = await supabase
    .from("product_shorts_media")
    .insert({
      project_id: input.projectId,
      user_id: userId,
      media_type: "photo",
      storage_path: photoPath,
      thumbnail_path: thumbPath,
      mime_type: photoMime,
      original_filename: input.originalFilename ?? null,
    })
    .select("id")
    .single();

  if (insertError || !mediaRow) {
    await supabase.storage.from(BUCKET).remove([photoPath, thumbPath]);
    return { error: "사진 정보를 저장하지 못했어요. 잠시 후 다시 시도해주세요." };
  }

  return { id: mediaRow.id };
}
