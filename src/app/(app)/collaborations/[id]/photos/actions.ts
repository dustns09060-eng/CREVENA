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
  if (uploadError) {
    console.error("uploadPhoto: storage upload failed", uploadError.message);
    return { error: "사진 업로드에 실패했습니다. 잠시 후 다시 시도해주세요." };
  }

  const { error: thumbError } = await supabase.storage
    .from(BUCKET)
    .upload(thumbPath, thumbFile, { contentType: "image/jpeg" });
  if (thumbError) {
    console.error("uploadPhoto: thumbnail upload failed", thumbError.message);
    return { error: "사진 업로드에 실패했습니다. 잠시 후 다시 시도해주세요." };
  }

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

  if (error) {
    console.error("uploadPhoto: db insert failed", error.message);
    return { error: "사진 저장에 실패했습니다. 잠시 후 다시 시도해주세요." };
  }

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

// STEP36 item 2: also persists the structured blogMeta (title/intro/closing/
// hashtags) into the existing (previously-Instagram/Threads-only)
// generation_input column, so it can be restored on refresh the same way
// PlatformPanel restores parts — mirrors the saveContent/updateContent split.
//
// STEP38: the Naver publish assistant's own state rides along inside this
// same jsonb column instead of a new table/migration —
// - `guideTextAtGeneration`: the brand guide's raw text at the moment this
//   blog was last written/auto-fixed, so the assistant can warn "가이드가
//   변경되었습니다" by comparing it against the guide's current raw text.
// - `publishState`: which sections the user has manually checked off while
//   copying into Naver, plus the URL/timestamp once they mark it published.
//   `completedStepIds` holds ids like "title", "intro", "photo:<photoId>",
//   "closing", "hashtags" — any id for a photo that no longer exists (or no
//   longer has a paragraph) is simply ignored when computing progress.
export type NaverPublishState = {
  completedStepIds: string[];
  publishedUrl?: string | null;
  publishedAt?: string | null;
};

export type BlogMeta = {
  title: string;
  intro: string;
  closing: string;
  hashtags: string;
  guideTextAtGeneration?: string | null;
  publishState?: NaverPublishState;
};

export async function savePhotoBlogToLibrary(input: {
  collaborationId: string;
  body: string;
  generationInput?: BlogMeta;
}) {
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
      generation_input: (input.generationInput ?? null) as never,
    })
    .select("id")
    .single();

  if (error) {
    console.error("saveBlog: db write failed", error.message);
    return { error: "저장에 실패했습니다. 잠시 후 다시 시도해주세요." };
  }

  revalidatePath("/content-library");
  return { success: true as const, id: data.id };
}

export async function updatePhotoBlogInLibrary(input: {
  contentId: string;
  collaborationId: string;
  body: string;
  generationInput?: BlogMeta;
}) {
  if (!input.body.trim()) return { error: "저장할 내용이 없습니다." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("contents")
    .update({ body: input.body, generation_input: (input.generationInput ?? null) as never })
    .eq("id", input.contentId);

  if (error) {
    console.error("saveBlog: db write failed", error.message);
    return { error: "저장에 실패했습니다. 잠시 후 다시 시도해주세요." };
  }

  revalidatePath("/content-library");
  return { success: true as const, id: input.contentId };
}

// STEP38: marks the blog's `contents` row as actually published to Naver.
// Reuses the existing `status` column ("POSTED" already exists in the
// ContentStatus check constraint — no migration) and stores the URL/time
// inside generation_input.publishState (see the BlogMeta comment above)
// instead of adding published_url/published_at columns.
export async function markPhotoBlogPublished(input: {
  contentId: string;
  collaborationId: string;
  generationInput: BlogMeta;
}) {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("contents")
    .update({ status: "POSTED", generation_input: input.generationInput as never })
    .eq("id", input.contentId);

  if (error) {
    console.error("saveBlog: db write failed", error.message);
    return { error: "저장에 실패했습니다. 잠시 후 다시 시도해주세요." };
  }

  revalidatePath("/content-library");
  revalidatePath(`/collaborations/${input.collaborationId}`);
  return { success: true as const };
}
