import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

const BUCKET = "product-shorts-media";

type Client = SupabaseClient<Database>;

export type DeletePhotoResult = { success: true } | { error: string };

// Mirrors src/lib/photos/delete-photo.ts's deleteCollaborationPhoto exactly
// (same file that fixed the "edited derivative left orphaned in Storage"
// bug earlier in this project) — Storage paths are read from the DB row
// itself, never trusted from a caller argument, and the DB row is deleted
// only after Storage deletion succeeds.
export async function deleteProductShortsMedia(supabase: Client, mediaId: string): Promise<DeletePhotoResult> {
  const { data: row, error: readError } = await supabase
    .from("product_shorts_media")
    .select("storage_path, thumbnail_path, edited_storage_path, edited_thumbnail_path")
    .eq("id", mediaId)
    .maybeSingle();

  if (readError) return { error: "사진 정보를 불러오지 못했어요." };
  if (!row) return { success: true }; // not found, or another user's (RLS) — nothing to do

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
      console.error("deleteProductShortsMedia: storage remove failed", removeError.message);
      return { error: "사진 파일을 삭제하지 못했어요. 잠시 후 다시 시도해주세요." };
    }
  }

  const { error: deleteError } = await supabase.from("product_shorts_media").delete().eq("id", mediaId);
  if (deleteError) {
    console.error("deleteProductShortsMedia: db delete failed after storage removal", deleteError.message);
    return { error: "사진 삭제에 실패했어요. 잠시 후 다시 시도해주세요." };
  }

  return { success: true };
}
