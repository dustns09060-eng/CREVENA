"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createProductShortsProject } from "@/lib/product-shorts/create-project";
import { uploadProductShortsPhoto } from "@/lib/product-shorts/upload-photo";
import { deleteProductShortsMedia } from "@/lib/product-shorts/delete-photo";
import { deleteProductShortsProject } from "@/lib/product-shorts/delete-project";
import { updateProductShortsSource } from "@/lib/product-shorts/update-product-source";
import type { ProductSource } from "@/lib/product-shorts/types";
import { loadGenerationState, saveFinalSelection } from "@/lib/product-shorts/persist";
import { sanitizeFinalSelection, type PhotoFinalSelection } from "@/lib/product-shorts/recommendation-types";

const BUCKET = "product-shorts-media";
const SIGNED_URL_TTL_SECONDS = 3600; // matches the existing collaboration-photos convention (content/page.tsx)

export async function createProject(input: { targetDurationSeconds: 15 | 30; productSource: ProductSource }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };

  const result = await createProductShortsProject(supabase, user.id, input);
  if ("error" in result) return result;

  revalidatePath("/product-shorts");
  return { success: true as const, id: result.id };
}

export async function uploadPhoto(projectId: string, formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };

  const photoFile = formData.get("photo") as File | null;
  const thumbFile = formData.get("thumbnail") as File | null;
  const originalFilename = (formData.get("filename") ?? "").toString() || null;
  if (!photoFile || !thumbFile) return { error: "이미지 파일이 없습니다." };

  const [photoBytes, thumbnailBytes] = await Promise.all([
    photoFile.arrayBuffer().then((b) => new Uint8Array(b)),
    thumbFile.arrayBuffer().then((b) => new Uint8Array(b)),
  ]);

  const result = await uploadProductShortsPhoto(supabase, user.id, {
    projectId,
    photoBytes,
    thumbnailBytes,
    originalFilename,
  });
  if ("error" in result) return result;

  revalidatePath(`/product-shorts/${projectId}`);
  return { success: true as const, id: result.id };
}

export async function deletePhoto(projectId: string, mediaId: string) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };

  const result = await deleteProductShortsMedia(supabase, mediaId);
  revalidatePath(`/product-shorts/${projectId}`);
  return result;
}

export async function deleteProject(projectId: string) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };

  const result = await deleteProductShortsProject(supabase, projectId);
  if ("success" in result) revalidatePath("/product-shorts");
  return result;
}

export async function updateProductSource(projectId: string, productSource: ProductSource) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };

  const result = await updateProductShortsSource(supabase, projectId, productSource);
  if ("success" in result) revalidatePath(`/product-shorts/${projectId}`);
  return result;
}

export type ProductShortsMediaWithUrl = {
  id: string;
  fullUrl: string | null;
  thumbUrl: string | null;
  originalFilename: string | null;
  displayOrder: number;
  aiAnalyzed: boolean;
};

// Signed URLs only — this is a PRIVATE bucket, never a public URL. Same
// 1-hour expiry as the existing collaboration-photos convention.
export async function listProjectMedia(projectId: string): Promise<ProductShortsMediaWithUrl[]> {
  const supabase = await createSupabaseServerClient();
  const { data: rows } = await supabase
    .from("product_shorts_media")
    .select("id, storage_path, thumbnail_path, original_filename, display_order, ai_analysis")
    .eq("project_id", projectId)
    .order("display_order", { ascending: true });

  if (!rows) return [];

  return Promise.all(
    rows.map(async (row) => {
      const [full, thumb] = await Promise.all([
        supabase.storage.from(BUCKET).createSignedUrl(row.storage_path, SIGNED_URL_TTL_SECONDS),
        row.thumbnail_path
          ? supabase.storage.from(BUCKET).createSignedUrl(row.thumbnail_path, SIGNED_URL_TTL_SECONDS)
          : Promise.resolve({ data: null }),
      ]);
      return {
        id: row.id,
        fullUrl: full.data?.signedUrl ?? null,
        thumbUrl: thumb.data?.signedUrl ?? full.data?.signedUrl ?? null,
        originalFilename: row.original_filename,
        displayOrder: row.display_order,
        aiAnalyzed: !!row.ai_analysis,
      };
    }),
  );
}

export async function getGenerationState(projectId: string) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };

  const result = await loadGenerationState(supabase, user.id, projectId);
  if ("error" in result) return result;
  return { success: true as const, state: result };
}

// §7: the AI's recommendation is never forced — the user's own final
// selection is stored separately (this action) and is always authoritative.
// Re-validates every id against the project's real media before saving,
// mirroring photo-select-actions.ts's savePhotoSelection re-validation
// pattern (without reusing collaborations.photo_select itself, per
// instruction).
export async function saveSelection(projectId: string, selection: PhotoFinalSelection) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };

  const { data: mediaRows } = await supabase.from("product_shorts_media").select("id").eq("project_id", projectId);
  const realMediaIds = new Set((mediaRows ?? []).map((m) => m.id));

  const sanitized = sanitizeFinalSelection(selection, realMediaIds);
  const result = await saveFinalSelection(supabase, user.id, projectId, sanitized);
  if ("error" in result) return result;

  revalidatePath(`/product-shorts/${projectId}`);
  return { success: true as const };
}
