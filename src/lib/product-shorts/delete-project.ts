import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

const BUCKET = "product-shorts-media";

type Client = SupabaseClient<Database>;

export type DeleteProjectResult = { success: true } | { error: string };

// Deletes an entire Product Shorts project: every media file's Storage
// objects, then the project row (which cascades to the media rows via the
// composite FK's ON DELETE CASCADE — see migration 0034). Same safe order
// as deleteProductShortsMedia: Storage first, DB only after Storage
// succeeds — a Storage failure leaves the project row (and its media rows)
// intact for a retry instead of losing the only record of what to clean up.
export async function deleteProductShortsProject(supabase: Client, projectId: string): Promise<DeleteProjectResult> {
  const { data: mediaRows, error: readError } = await supabase
    .from("product_shorts_media")
    .select("storage_path, thumbnail_path, edited_storage_path, edited_thumbnail_path")
    .eq("project_id", projectId);

  if (readError) return { error: "프로젝트 정보를 불러오지 못했어요." };

  const paths = [
    ...new Set(
      (mediaRows ?? [])
        .flatMap((r) => [r.storage_path, r.thumbnail_path, r.edited_storage_path, r.edited_thumbnail_path])
        .filter((p): p is string => !!p),
    ),
  ];

  if (paths.length > 0) {
    const { error: removeError } = await supabase.storage.from(BUCKET).remove(paths);
    if (removeError) {
      console.error("deleteProductShortsProject: storage remove failed", removeError.message);
      return { error: "프로젝트 파일을 삭제하지 못했어요. 잠시 후 다시 시도해주세요." };
    }
  }

  // RLS scopes this delete to the caller's own project (user_id =
  // auth.uid()); a foreign projectId simply matches zero rows, same no-op
  // posture as elsewhere in this codebase.
  const { error: deleteError } = await supabase.from("product_shorts_projects").delete().eq("id", projectId);
  if (deleteError) {
    console.error("deleteProductShortsProject: db delete failed after storage removal", deleteError.message);
    return { error: "프로젝트 삭제에 실패했어요. 잠시 후 다시 시도해주세요." };
  }

  return { success: true };
}
