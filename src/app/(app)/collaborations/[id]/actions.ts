"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { COLLABORATION_STATUSES } from "@/lib/collaboration-status";
import type { CollaborationStatus } from "@/types/database";

export type SaveGuideState = { error: string } | { success: true } | null;

export type UpdateStatusState = { error: string } | null;

export async function updateStatus(
  collaborationId: string,
  _prevState: UpdateStatusState,
  formData: FormData,
): Promise<UpdateStatusState> {
  const status = (formData.get("status") ?? "").toString();
  if (!COLLABORATION_STATUSES.includes(status as CollaborationStatus)) {
    return { error: "올바르지 않은 상태 값입니다." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("collaborations")
    .update({ status: status as CollaborationStatus })
    .eq("id", collaborationId);

  if (error) {
    return { error: `상태 변경 실패: ${error.message}` };
  }

  revalidatePath(`/collaborations/${collaborationId}`);
  revalidatePath("/collaborations");
  return null;
}

export async function saveGuide(
  collaborationId: string,
  _prevState: SaveGuideState,
  formData: FormData,
): Promise<SaveGuideState> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "로그인이 필요합니다." };
  }

  const rawContent = (formData.get("raw_content") ?? "").toString().trim();
  if (!rawContent) {
    return { error: "가이드라인 내용을 입력해주세요." };
  }

  const { data: existing } = await supabase
    .from("collaboration_guides")
    .select("id")
    .eq("collaboration_id", collaborationId)
    .maybeSingle();

  const { error } = existing
    ? await supabase
        .from("collaboration_guides")
        .update({ raw_content: rawContent })
        .eq("id", existing.id)
    : await supabase.from("collaboration_guides").insert({
        collaboration_id: collaborationId,
        user_id: user.id,
        raw_content: rawContent,
      });

  if (error) {
    return { error: `저장 실패: ${error.message}` };
  }

  revalidatePath(`/collaborations/${collaborationId}`);
  return { success: true };
}
