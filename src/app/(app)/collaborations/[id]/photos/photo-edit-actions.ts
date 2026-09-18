"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { PhotoAdjustments } from "@/lib/photo-edit/types";

const BUCKET = "collaboration-photos";

// ---------------------------------------------------------------------------
// Presets — reusable across collaborations, scoped to the current user
// (photo_presets table, STEP43.5 migration 0022/0023). Only the parsed,
// supported adjustment values are ever stored — never the raw XMP XML.
// ---------------------------------------------------------------------------

export async function listPhotoPresets() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };

  const { data, error } = await supabase
    .from("photo_presets")
    .select("id, preset_name, source_filename, settings, updated_at")
    .order("updated_at", { ascending: false });
  if (error) return { error: "프리셋 목록을 불러오지 못했습니다." };
  return { success: true as const, presets: data };
}

// Returns { conflict: true, existingId } instead of inserting when the user
// already has a preset with this exact name (unique(user_id, preset_name)),
// so the caller can offer "기존 프리셋 교체" / "새 이름으로 저장" / "취소"
// without racing a blind insert-then-catch.
export async function savePhotoPreset(input: {
  presetName: string;
  sourceFilename: string | null;
  settings: PhotoAdjustments;
}) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };

  const trimmedName = input.presetName.trim();
  if (!trimmedName) return { error: "프리셋 이름을 입력해주세요." };
  if (!input.settings || Object.keys(input.settings).length === 0) {
    return { error: "이 프리셋에는 CREVENA가 적용할 수 있는 보정값이 없어요." };
  }

  const { data: existing } = await supabase
    .from("photo_presets")
    .select("id")
    .eq("user_id", user.id)
    .eq("preset_name", trimmedName)
    .maybeSingle();
  if (existing) return { conflict: true as const, existingId: existing.id };

  const { data, error } = await supabase
    .from("photo_presets")
    .insert({
      user_id: user.id,
      preset_name: trimmedName,
      source_filename: input.sourceFilename,
      settings: input.settings as never,
    })
    .select("id")
    .single();
  if (error) return { error: "프리셋 저장에 실패했습니다." };
  return { success: true as const, id: data.id };
}

export async function replacePhotoPreset(
  presetId: string,
  input: { sourceFilename: string | null; settings: PhotoAdjustments },
) {
  const supabase = await createSupabaseServerClient();
  if (!input.settings || Object.keys(input.settings).length === 0) {
    return { error: "이 프리셋에는 CREVENA가 적용할 수 있는 보정값이 없어요." };
  }
  const { error } = await supabase
    .from("photo_presets")
    .update({ source_filename: input.sourceFilename, settings: input.settings as never })
    .eq("id", presetId);
  if (error) return { error: "프리셋 교체에 실패했습니다." };
  return { success: true as const };
}

export async function deletePhotoPreset(presetId: string) {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("photo_presets").delete().eq("id", presetId);
  if (error) return { error: "프리셋 삭제에 실패했습니다." };
  return { success: true as const };
}

// A dedicated lookup for the TRUE original — always signs storage_path,
// never edited_storage_path. The editor must always render from the
// original pixels (STEP43.5 rule "절대 누적 보정 금지": ORIGINAL → preset,
// never Edited → preset), and the shared PhotoWithUrl.fullUrl elsewhere in
// the app intentionally prefers the edited derivative when one exists, so
// it can't be reused here.
export async function getOriginalPhotoUrl(photoId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: row, error: readError } = await supabase
    .from("collaboration_photos")
    .select("storage_path")
    .eq("id", photoId)
    .maybeSingle();
  if (readError || !row) return { error: "사진 정보를 불러오지 못했어요." };

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(row.storage_path, 3600);
  if (error || !data) return { error: "사진을 불러오지 못했어요." };
  return { success: true as const, url: data.signedUrl };
}

// ---------------------------------------------------------------------------
// Applying / restoring an edit on a single photo. Pixel processing itself
// happens client-side (src/lib/photo-edit/engine.ts) — these actions only
// persist the already-rendered result.
// ---------------------------------------------------------------------------

// Ordering matters here (STEP43.5 rules 9/10): the new derivative is
// uploaded to a DETERMINISTIC path with upsert, so re-editing a photo never
// accumulates orphan files — the same slot is overwritten. The DB row is
// only updated AFTER a successful upload, so a failed upload never leaves a
// broken edited_storage_path, and the previous good edited image (if any)
// is never lost to a failed new attempt (Storage upload() only replaces an
// object on success; a failed call leaves the existing object untouched).
export async function applyPhotoEdit(
  collaborationId: string,
  photoId: string,
  formData: FormData,
) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };

  const editedFile = formData.get("edited") as File | null;
  const editedThumbFile = formData.get("editedThumbnail") as File | null;
  const presetName = (formData.get("presetName") ?? "").toString() || null;
  const intensityRaw = Number(formData.get("intensity") ?? "0");
  const intensity = Number.isFinite(intensityRaw) ? Math.max(0, Math.min(100, Math.round(intensityRaw))) : null;
  if (!editedFile || !editedThumbFile) return { error: "보정된 이미지가 없습니다." };

  const editedPath = `${user.id}/${collaborationId}/${photoId}_edited.jpg`;
  const editedThumbPath = `${user.id}/${collaborationId}/${photoId}_edited_thumb.jpg`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(editedPath, editedFile, { contentType: "image/jpeg", upsert: true });
  if (uploadError) return { error: "보정된 사진을 저장하지 못했어요. 잠시 후 다시 시도해주세요." };

  const { error: thumbUploadError } = await supabase.storage
    .from(BUCKET)
    .upload(editedThumbPath, editedThumbFile, { contentType: "image/jpeg", upsert: true });
  if (thumbUploadError) return { error: "보정된 썸네일을 저장하지 못했어요. 잠시 후 다시 시도해주세요." };

  const { error: dbError } = await supabase
    .from("collaboration_photos")
    .update({
      edited_storage_path: editedPath,
      edited_thumbnail_path: editedThumbPath,
      edit_preset_name: presetName,
      edit_intensity: intensity,
    })
    .eq("id", photoId);
  if (dbError) return { error: "보정 결과를 반영하지 못했어요. 잠시 후 다시 시도해주세요." };

  revalidatePath(`/collaborations/${collaborationId}/content`);
  return { success: true as const };
}

export async function restorePhotoOriginal(collaborationId: string, photoId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: row, error: readError } = await supabase
    .from("collaboration_photos")
    .select("edited_storage_path, edited_thumbnail_path")
    .eq("id", photoId)
    .maybeSingle();
  if (readError) return { error: "사진 정보를 불러오지 못했어요." };

  // Null the DB pointers first — the app must stop referencing the edited
  // derivative immediately, even if the Storage cleanup below fails.
  const { error: dbError } = await supabase
    .from("collaboration_photos")
    .update({
      edited_storage_path: null,
      edited_thumbnail_path: null,
      edit_preset_name: null,
      edit_intensity: null,
    })
    .eq("id", photoId);
  if (dbError) return { error: "원본 복원에 실패했어요. 잠시 후 다시 시도해주세요." };

  const pathsToRemove = [row?.edited_storage_path, row?.edited_thumbnail_path].filter(
    (p): p is string => !!p,
  );
  if (pathsToRemove.length > 0) {
    // Best-effort: if this fails, the object is simply orphaned (harmless —
    // nothing in the DB points to it, and the next edit reuses/overwrites
    // the same deterministic path anyway). It must never block the restore
    // the user already sees succeed above, and must never touch storage_path
    // /thumbnail_path (the original).
    const { error: removeError } = await supabase.storage.from(BUCKET).remove(pathsToRemove);
    if (removeError) {
      console.error("restorePhotoOriginal: storage cleanup failed (non-fatal)", removeError.message);
    }
  }

  revalidatePath(`/collaborations/${collaborationId}/content`);
  return { success: true as const };
}
