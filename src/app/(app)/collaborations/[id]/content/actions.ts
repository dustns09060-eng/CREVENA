"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CONTENT_STATUSES } from "@/lib/content-status";
import { getPlanConfig } from "@/lib/plans";
import { isUnlimitedUser } from "@/lib/entitlements";
import type { ContentPlatformKey } from "@/lib/ai/prompts";
import type { ContentStatus } from "@/types/database";

type ActionResult = { error: string } | { success: true; id: string };

export async function saveContent(input: {
  collaborationId: string;
  platform: ContentPlatformKey;
  body: string;
  // Structured per-field parts (InstagramParts / ThreadsParts) so the
  // editable UI can be restored on refresh without re-parsing the flattened
  // body text. Reuses the existing (previously unused) generation_input
  // column instead of adding new schema.
  generationInput?: unknown;
}): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };
  if (!input.body.trim()) return { error: "저장할 내용이 없습니다." };

  // Downgrading never deletes existing contents, but a plan's storage limit
  // does block creating NEW ones once at/over it (STEP29).
  const { data: profile } = await supabase.from("users").select("plan_tier").eq("id", user.id).maybeSingle();
  // STEP48: unlimited owner accounts have no save cap (null = unlimited).
  const maxContents = (await isUnlimitedUser(supabase, user.id))
    ? null
    : getPlanConfig(profile?.plan_tier).maxContents;
  if (maxContents !== null) {
    const { count } = await supabase
      .from("contents")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);
    if ((count ?? 0) >= maxContents) {
      return {
        error: `현재 플랜의 콘텐츠 저장 한도(${maxContents}건)를 초과했습니다. 기존 콘텐츠를 정리하거나 플랜을 업그레이드해주세요.`,
      };
    }
  }

  const { data, error } = await supabase
    .from("contents")
    .insert({
      collaboration_id: input.collaborationId,
      user_id: user.id,
      platform: input.platform,
      body: input.body,
      status: "DRAFT",
      ai_provider: "claude",
      generation_input: (input.generationInput ?? null) as never,
    })
    .select("id")
    .single();

  if (error) return { error: `저장 실패: ${error.message}` };

  revalidatePath(`/collaborations/${input.collaborationId}/content`);
  return { success: true, id: data.id };
}

export async function updateContent(input: {
  contentId: string;
  collaborationId: string;
  body: string;
  generationInput?: unknown;
}): Promise<ActionResult> {
  if (!input.body.trim()) return { error: "저장할 내용이 없습니다." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("contents")
    .update({ body: input.body, generation_input: (input.generationInput ?? null) as never })
    .eq("id", input.contentId);

  if (error) return { error: `저장 실패: ${error.message}` };

  revalidatePath(`/collaborations/${input.collaborationId}/content`);
  return { success: true, id: input.contentId };
}

export async function updateContentStatus(input: {
  contentId: string;
  collaborationId: string;
  status: ContentStatus;
}): Promise<ActionResult> {
  if (!CONTENT_STATUSES.includes(input.status)) {
    return { error: "올바르지 않은 상태 값입니다." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("contents")
    .update({ status: input.status })
    .eq("id", input.contentId);

  if (error) return { error: `상태 변경 실패: ${error.message}` };

  revalidatePath(`/collaborations/${input.collaborationId}/content`);
  return { success: true, id: input.contentId };
}
