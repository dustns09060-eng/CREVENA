import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

const BUCKET = "collaboration-photos";

type Client = SupabaseClient<Database>;

export type DeletePhotoResult = { success: true } | { error: string };

// The only place a single photo (and its Storage files) is deleted. Account
// deletion has its own bulk cleanup (src/app/api/account/delete/route.ts)
// and is not touched by this file.
//
// Before this existed, the caller (deletePhoto in
// src/app/(app)/collaborations/[id]/photos/actions.ts) only removed
// storage_path/thumbnail_path — paths the CLIENT passed in — and never
// looked at edited_storage_path/edited_thumbnail_path (the XMP-preset
// derivative from photo-edit-actions.ts), which then sat in Storage forever
// with no DB row left to find them again.
//
// Rules:
//  1. Storage paths are read from the DB row itself (RLS-scoped to the
//     caller's own session via `supabase`), never trusted from an argument
//     — the caller can no longer point this at another user's files, and a
//     photo id that does not belong to the caller (or no longer exists)
//     simply matches no row (see NOT_FOUND below), the same no-op the old
//     code already had via RLS on the DB delete.
//  2. All four possible paths (original, thumbnail, edited original, edited
//     thumbnail) are collected, NULLs dropped, duplicates removed.
//  3. The DB row is deleted only AFTER Storage deletion succeeds. If Storage
//     deletion fails, the row is left intact so the photo (and its files)
//     can be retried, instead of deleting the only record of where an
//     unremoved file lives.
export async function deleteCollaborationPhoto(supabase: Client, photoId: string): Promise<DeletePhotoResult> {
  const { data: row, error: readError } = await supabase
    .from("collaboration_photos")
    .select("storage_path, thumbnail_path, edited_storage_path, edited_thumbnail_path")
    .eq("id", photoId)
    .maybeSingle();

  if (readError) return { error: "사진 정보를 불러오지 못했어요." };
  // Not found, or belongs to another user (RLS silently excludes it from
  // the select above) — nothing for this caller to delete. Matches the
  // previous behavior, where an unauthorized id's DB delete simply matched
  // zero rows under RLS.
  if (!row) return { success: true };

  const paths = [
    ...new Set(
      [row.storage_path, row.thumbnail_path, row.edited_storage_path, row.edited_thumbnail_path].filter(
        (p): p is string => !!p,
      ),
    ),
  ];

  if (paths.length > 0) {
    const { error: removeError } = await supabase.storage.from(BUCKET).remove(paths);
    if (removeError) {
      console.error("deleteCollaborationPhoto: storage remove failed", removeError.message);
      return { error: "사진 파일을 삭제하지 못했어요. 잠시 후 다시 시도해주세요." };
    }
  }

  const { error: deleteError } = await supabase.from("collaboration_photos").delete().eq("id", photoId);
  if (deleteError) {
    // Storage is already gone at this point but the DB row survives — the
    // photo shows as broken (its files are gone) until the row is deleted.
    // A retry re-reads this same row, finds nothing left in Storage to
    // remove (Supabase Storage remove() is a no-op for paths that no longer
    // exist, not an error), and then deletes the row — self-healing, but
    // this window is a real "reverse orphan": a DB row pointing at Storage
    // objects that no longer exist. Not hidden here; see the PR report.
    console.error("deleteCollaborationPhoto: db delete failed after storage removal", deleteError.message);
    return { error: "사진 삭제에 실패했어요. 잠시 후 다시 시도해주세요." };
  }

  return { success: true };
}
