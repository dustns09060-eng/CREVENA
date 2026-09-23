import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import type { ProductSource } from "./types";

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
  const { data, error } = await supabase
    .from("product_shorts_projects")
    .insert({
      user_id: userId,
      source_url: input.productSource.sourceUrl,
      source_host: input.productSource.sourceHost,
      target_duration_seconds: input.targetDurationSeconds,
      product_source: input.productSource as unknown as Json,
    })
    .select("id")
    .single();

  if (error || !data) return { error: "프로젝트를 만들지 못했어요. 잠시 후 다시 시도해주세요." };
  return { id: data.id };
}
