"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

// STEP41: the whole Carousel project (card order/text/design settings/guide
// snapshot) lives in contents.generation_input jsonb for a platform='CAROUSEL'
// row — same pattern as ReelsProject (../reels/actions.ts) and BlogMeta. No
// dedicated carousel_projects table, and no new photo-ordering column: cards
// just reference an existing collaboration_photos.id.
export type CarouselCardRole =
  | "cover"
  | "product"
  | "detail"
  | "usage"
  | "feature"
  | "experience"
  | "closing";

export type CarouselCard = {
  id: string;
  photoId: string;
  role: CarouselCardRole;
  headline: string;
  body: string;
  included: boolean;
  textPosition: "top" | "middle" | "bottom";
  textAlign: "left" | "center" | "right";
  headlineSize: "small" | "medium" | "large";
};

export type CarouselTemplate = "minimal" | "clean" | "soft";
export type CarouselAspectRatio = "4:5" | "1:1";

// Card order is simply the array's own order (moveCard swaps positions),
// exactly like ReelsProject.scenes — no separate numeric `order` field to
// keep in sync, avoiding a second source of truth for the same thing.
export type CarouselProject = {
  cards: CarouselCard[];
  template: CarouselTemplate;
  aspectRatio: CarouselAspectRatio;
  guideTextAtGeneration?: string | null;
};

export async function saveCarouselProject(input: {
  collaborationId: string;
  contentId?: string | null;
  project: CarouselProject;
}) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };

  if (input.contentId) {
    const { error } = await supabase
      .from("contents")
      .update({ generation_input: input.project as unknown as Json })
      .eq("id", input.contentId);
    if (error) return { error: `저장 실패: ${error.message}` };
    revalidatePath(`/collaborations/${input.collaborationId}/content`);
    return { success: true as const, id: input.contentId };
  }

  const { data, error } = await supabase
    .from("contents")
    .insert({
      collaboration_id: input.collaborationId,
      user_id: user.id,
      platform: "CAROUSEL",
      status: "DRAFT",
      ai_provider: "claude",
      generation_input: input.project as unknown as Json,
    })
    .select("id")
    .single();

  if (error) return { error: `저장 실패: ${error.message}` };
  revalidatePath(`/collaborations/${input.collaborationId}/content`);
  return { success: true as const, id: data.id };
}
