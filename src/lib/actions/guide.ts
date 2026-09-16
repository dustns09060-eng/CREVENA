"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Plain onBlur-save counterpart to GuideForm.tsx's useActionState-based
// saveGuide (src/app/(app)/collaborations/[id]/actions.ts) — same table/
// columns, just fire-and-forget so the studio's guide textarea can save the
// same way the review-notes fields already do (src/lib/actions/review-notes.ts)
// instead of needing a submit button.
export async function updateGuideRawContent(
  collaborationId: string,
  rawContent: string,
): Promise<{ error: string } | { success: true }> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };

  const { data: existing } = await supabase
    .from("collaboration_guides")
    .select("id")
    .eq("collaboration_id", collaborationId)
    .maybeSingle();

  const { error } = existing
    ? await supabase.from("collaboration_guides").update({ raw_content: rawContent }).eq("id", existing.id)
    : await supabase
        .from("collaboration_guides")
        .insert({ collaboration_id: collaborationId, user_id: user.id, raw_content: rawContent });

  if (error) return { error: `저장 실패: ${error.message}` };

  revalidatePath(`/collaborations/${collaborationId}/content`);
  return { success: true as const };
}
