"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AddStyleState = { error: string } | null;

export async function addCreatorStyle(
  _prevState: AddStyleState,
  formData: FormData,
): Promise<AddStyleState> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };

  const styleName = (formData.get("style_name") ?? "").toString().trim();
  const sampleText = (formData.get("sample_text") ?? "").toString().trim();

  if (!styleName || !sampleText) {
    return { error: "스타일 이름과 예시 글을 모두 입력해주세요." };
  }

  const { error } = await supabase.from("creator_styles").insert({
    user_id: user.id,
    style_name: styleName,
    sample_text: sampleText,
  });

  if (error) return { error: `저장 실패: ${error.message}` };

  revalidatePath("/settings");
  return null;
}

export async function deleteCreatorStyle(styleId: string) {
  const supabase = await createSupabaseServerClient();
  await supabase.from("creator_styles").delete().eq("id", styleId);
  revalidatePath("/settings");
}
