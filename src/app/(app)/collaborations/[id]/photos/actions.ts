"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const BUCKET = "collaboration-photos";

export async function uploadPhoto(collaborationId: string, formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };

  const photoFile = formData.get("photo") as File | null;
  const thumbFile = formData.get("thumbnail") as File | null;
  const originalFilename = (formData.get("filename") ?? "").toString() || null;
  if (!photoFile || !thumbFile) return { error: "이미지 파일이 없습니다." };

  const photoId = crypto.randomUUID();
  const photoPath = `${user.id}/${collaborationId}/${photoId}.jpg`;
  const thumbPath = `${user.id}/${collaborationId}/${photoId}_thumb.jpg`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(photoPath, photoFile, { contentType: "image/jpeg" });
  if (uploadError) return { error: `업로드 실패: ${uploadError.message}` };

  const { error: thumbError } = await supabase.storage
    .from(BUCKET)
    .upload(thumbPath, thumbFile, { contentType: "image/jpeg" });
  if (thumbError) return { error: `썸네일 업로드 실패: ${thumbError.message}` };

  const { count } = await supabase
    .from("collaboration_photos")
    .select("id", { count: "exact", head: true })
    .eq("collaboration_id", collaborationId);

  const { data, error } = await supabase
    .from("collaboration_photos")
    .insert({
      id: photoId,
      collaboration_id: collaborationId,
      user_id: user.id,
      storage_path: photoPath,
      thumbnail_path: thumbPath,
      original_filename: originalFilename,
      display_order: count ?? 0,
    })
    .select("id")
    .single();

  if (error) return { error: `저장 실패: ${error.message}` };

  revalidatePath(`/collaborations/${collaborationId}/photos`);
  return { success: true as const, id: data.id };
}

export async function reorderPhotos(collaborationId: string, orderedIds: string[]) {
  const supabase = await createSupabaseServerClient();
  await Promise.all(
    orderedIds.map((id, index) =>
      supabase.from("collaboration_photos").update({ display_order: index }).eq("id", id),
    ),
  );
  revalidatePath(`/collaborations/${collaborationId}/photos`);
}

export async function updatePhotoMemo(collaborationId: string, photoId: string, memo: string) {
  const supabase = await createSupabaseServerClient();
  await supabase.from("collaboration_photos").update({ user_memo: memo }).eq("id", photoId);
  revalidatePath(`/collaborations/${collaborationId}/photos`);
}

// Used for AI-written paragraphs (full blog write or single-photo regenerate).
// Always clears body_edited since this is fresh AI output, not a manual edit.
export async function savePhotoBodySections(
  collaborationId: string,
  sections: { photoId: string; body: string }[],
) {
  const supabase = await createSupabaseServerClient();
  await Promise.all(
    sections.map((s) =>
      supabase
        .from("collaboration_photos")
        .update({ body_section: s.body, body_edited: false })
        .eq("id", s.photoId),
    ),
  );
  revalidatePath(`/collaborations/${collaborationId}/photos`);
}

// Used when the user types directly into a paragraph. Marks it as manually
// edited so a later full blog regeneration won't silently overwrite it.
export async function updatePhotoBodyManual(collaborationId: string, photoId: string, body: string) {
  const supabase = await createSupabaseServerClient();
  await supabase
    .from("collaboration_photos")
    .update({ body_section: body, body_edited: true })
    .eq("id", photoId);
  revalidatePath(`/collaborations/${collaborationId}/photos`);
}

export async function deletePhoto(
  collaborationId: string,
  photoId: string,
  storagePath: string,
  thumbnailPath: string,
) {
  const supabase = await createSupabaseServerClient();
  await supabase.storage.from(BUCKET).remove([storagePath, thumbnailPath]);
  await supabase.from("collaboration_photos").delete().eq("id", photoId);
  revalidatePath(`/collaborations/${collaborationId}/photos`);
}

export async function savePhotoBlogToLibrary(input: { collaborationId: string; body: string }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };
  if (!input.body.trim()) return { error: "저장할 내용이 없습니다." };

  const { data, error } = await supabase
    .from("contents")
    .insert({
      collaboration_id: input.collaborationId,
      user_id: user.id,
      platform: "NAVER_BLOG",
      body: input.body,
      status: "DRAFT",
      ai_provider: "claude",
    })
    .select("id")
    .single();

  if (error) return { error: `저장 실패: ${error.message}` };

  revalidatePath("/content-library");
  return { success: true as const, id: data.id };
}
