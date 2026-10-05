import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import type { ProductSource } from "./types";
import { sanitizeProductSource } from "./validate-product-source";

type Client = SupabaseClient<Database>;

export type CreateProjectResult = { id: string } | { error: string };

// The ONLY place a product_shorts_projects row is created. `userId` must
// come from the caller's own authenticated session (supabase.auth.getUser()
// in the server action) — never from a client-supplied field in the
// request body. RLS's `with check (user_id = auth.uid())` is defense in
// depth here, not the only guard: this function never even attempts to
// accept a caller-chosen user_id.
export async function createProductShortsProject(
  supabase: Client,
  userId: string,
  input: { targetDurationSeconds: 15 | 30; productSource: ProductSource },
): Promise<CreateProjectResult> {
  // The client's ProductSource is never stored as-is: platform/sourceHost are recomputed and
  // evidence is allow-list checked on the server.
  const checked = sanitizeProductSource(input.productSource);
  if (!checked.ok) return { error: "상품 정보 형식이 올바르지 않아요." };
  const productSource = checked.source;

  const { data, error } = await supabase
    .from("product_shorts_projects")
    .insert({
      user_id: userId,
      source_url: productSource.sourceUrl,
      source_host: productSource.sourceHost,
      target_duration_seconds: input.targetDurationSeconds,
      product_source: productSource as unknown as Json,
    })
    .select("id")
    .single();

  if (error || !data) return { error: "프로젝트를 만들지 못했어요. 잠시 후 다시 시도해주세요." };
  return { id: data.id };
}
