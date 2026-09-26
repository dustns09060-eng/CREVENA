// Ownership-checked read/write of Product Shorts' AI generation state
// (recommendation + user's final selection + generated plan).
//
// Persisted in product_shorts_projects.reels_project as a
// ProductShortsGenerationState — deliberately NOT a new column/migration.
// This was evaluated per §16: product_shorts_projects already carries a
// free-form jsonb column reserved for exactly this kind of "this project's
// generation state" blob (the same pattern contents.generation_input already
// uses for Reels/Carousel/Naver Clip elsewhere in this codebase — see
// collaborations/[id]/reels/actions.ts's saveReelsProject). Packing
// recommendation+selection+plan into it together is not a forced fit: the
// `plan` sub-field is a real ReelsProject-shaped value, so a future
// ReelsStudio/MP4 integration can lift it out unchanged. No migration was
// written or proposed.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import {
  emptyGenerationState,
  type ProductShortsGenerationState,
  type PhotoFinalSelection,
  type PhotoRecommendationRun,
} from "./recommendation-types";
import type { ReelsProject } from "@/app/(app)/collaborations/[id]/reels/actions";
import { sanitizeEditedPlan } from "./edit-plan";

type Client = SupabaseClient<Database>;

export type OwnedProject = { id: string; targetDurationSeconds: 15 | 30 };

// Every mutating action in this phase must go through this first: confirms
// the project exists AND belongs to the calling user before anything else
// happens. RLS also enforces this at the DB layer, but checking explicitly
// lets us return a clear Korean error instead of a silent empty result.
export async function assertOwnsProject(
  supabase: Client,
  userId: string,
  projectId: string,
): Promise<OwnedProject | { error: string }> {
  const { data, error } = await supabase
    .from("product_shorts_projects")
    .select("id, user_id, target_duration_seconds")
    .eq("id", projectId)
    .maybeSingle();
  if (error || !data) return { error: "프로젝트를 찾을 수 없습니다." };
  if (data.user_id !== userId) return { error: "권한이 없습니다." };
  const target = data.target_duration_seconds === 30 ? 30 : 15;
  return { id: data.id, targetDurationSeconds: target };
}

export async function assertOwnsMedia(
  supabase: Client,
  userId: string,
  projectId: string,
  mediaId: string,
): Promise<{ id: string; storagePath: string; aiAnalysis: string | null } | { error: string }> {
  const { data, error } = await supabase
    .from("product_shorts_media")
    .select("id, project_id, user_id, storage_path, ai_analysis")
    .eq("id", mediaId)
    .maybeSingle();
  if (error || !data) return { error: "사진을 찾을 수 없습니다." };
  if (data.user_id !== userId || data.project_id !== projectId) return { error: "권한이 없습니다." };
  return { id: data.id, storagePath: data.storage_path, aiAnalysis: data.ai_analysis };
}

export async function loadGenerationState(
  supabase: Client,
  userId: string,
  projectId: string,
): Promise<ProductShortsGenerationState | { error: string }> {
  const owned = await assertOwnsProject(supabase, userId, projectId);
  if ("error" in owned) return owned;

  const { data, error } = await supabase
    .from("product_shorts_projects")
    .select("reels_project")
    .eq("id", projectId)
    .maybeSingle();
  if (error) return { error: "불러오기 실패" };
  const raw = data?.reels_project;
  if (!raw || typeof raw !== "object") return emptyGenerationState();
  const state = raw as unknown as Partial<ProductShortsGenerationState>;
  return {
    version: 1,
    recommendation: state.recommendation ?? null,
    selection: state.selection ?? { pinnedIds: [], excludedIds: [], includedIds: [], coverMediaId: null },
    plan: state.plan ?? null,
  };
}

async function writeState(supabase: Client, userId: string, projectId: string, state: ProductShortsGenerationState) {
  const owned = await assertOwnsProject(supabase, userId, projectId);
  if ("error" in owned) return owned;

  const { error } = await supabase
    .from("product_shorts_projects")
    .update({ reels_project: state as unknown as Json })
    .eq("id", projectId);
  if (error) return { error: `저장 실패: ${error.message}` };
  return { success: true as const };
}

export async function saveRecommendation(
  supabase: Client,
  userId: string,
  projectId: string,
  run: PhotoRecommendationRun,
) {
  const current = await loadGenerationState(supabase, userId, projectId);
  if ("error" in current) return current;
  return writeState(supabase, userId, projectId, { ...current, recommendation: run });
}

export async function saveFinalSelection(
  supabase: Client,
  userId: string,
  projectId: string,
  selection: PhotoFinalSelection,
) {
  const current = await loadGenerationState(supabase, userId, projectId);
  if ("error" in current) return current;
  return writeState(supabase, userId, projectId, { ...current, selection });
}

export async function savePlan(supabase: Client, userId: string, projectId: string, plan: ReelsProject) {
  const current = await loadGenerationState(supabase, userId, projectId);
  if ("error" in current) return current;
  return writeState(supabase, userId, projectId, { ...current, plan });
}

// Studio save (Phase 5): validates the edited ReelsProject against this
// project's real media and the stored plan, then writes ONLY
// reels_project.plan. Refuses when no AI plan exists yet, so the studio can
// never be used to create a plan out of thin air. No AI, no credits.
export async function saveEditedPlan(supabase: Client, userId: string, projectId: string, edited: unknown) {
  const owned = await assertOwnsProject(supabase, userId, projectId);
  if ("error" in owned) return owned;

  const state = await loadGenerationState(supabase, userId, projectId);
  if ("error" in state) return state;
  if (!state.plan) return { error: "먼저 숏츠 구성을 만들어주세요." };

  const { data: mediaRows, error } = await supabase
    .from("product_shorts_media")
    .select("id")
    .eq("project_id", projectId)
    .eq("user_id", userId);
  if (error) return { error: "사진 정보를 확인하지 못했어요." };

  const result = sanitizeEditedPlan(edited, state.plan, owned.targetDurationSeconds, new Set((mediaRows ?? []).map((m) => m.id)));
  if (!result.ok) return { error: result.error };

  return writeState(supabase, userId, projectId, { ...state, plan: result.plan });
}
