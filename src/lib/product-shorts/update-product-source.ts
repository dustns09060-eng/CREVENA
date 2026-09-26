import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import type { ProductSource } from "./types";

type Client = SupabaseClient<Database>;

export type UpdateProductSourceResult = { success: true } | { error: string };

// RLS's `using (user_id = auth.uid())` on product_shorts_projects already
// scopes which rows this UPDATE can even target for the real Supabase
// client — a foreign projectId matches zero rows there (no error, just no
// effect). This function additionally checks `data` (the updated row
// Supabase returns) is non-null so a silent zero-row update is reported as
// a failure here rather than a false "success" — belt-and-braces on top of
// RLS, not a replacement for it. `user_id` is never part of the payload.
export async function updateProductShortsSource(
  supabase: Client,
  projectId: string,
  productSource: ProductSource,
): Promise<UpdateProductSourceResult> {
  const { data, error } = await supabase
    .from("product_shorts_projects")
    .update({
      product_source: productSource as unknown as Json,
      source_url: productSource.sourceUrl,
      source_host: productSource.sourceHost,
    })
    .eq("id", projectId)
    .select("id")
    .maybeSingle();

  if (error) return { error: "상품 정보를 저장하지 못했어요." };
  if (!data) return { error: "프로젝트를 찾을 수 없어요." }; // not found, or not owned by the caller (RLS)
  return { success: true };
}
