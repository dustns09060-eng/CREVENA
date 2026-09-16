"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ReviewNotes } from "@/lib/ai/prompts";

// Shared by the content studio (/content) and photo blog studio (/photos)
// screens so "후기 메모" typed in one place doesn't have to be retyped in
// the other, and isn't lost if the user navigates away before generating.
export async function updateReviewNotes(collaborationId: string, notes: ReviewNotes) {
  const supabase = await createSupabaseServerClient();
  await supabase
    .from("collaborations")
    .update({ review_notes: notes })
    .eq("id", collaborationId);
  revalidatePath(`/collaborations/${collaborationId}/content`);
  revalidatePath(`/collaborations/${collaborationId}/photos`);
}
