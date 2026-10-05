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
import type { AngleSuggestionSet } from "./angle-types";

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

const EMPTY_SELECTION: PhotoFinalSelection = { pinnedIds: [], excludedIds: [], includedIds: [], coverMediaId: null };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// A "version" (A/B/C) is one row of product_shorts_plans. Every function below
// takes an optional `versionId`: without it they read/write the project's
// single V1 state in product_shorts_projects.reels_project exactly as before;
// with it they read/write ONLY that version's row, so versions can never
// overwrite one another.
export async function assertOwnsVersion(
  supabase: Client,
  userId: string,
  projectId: string,
  versionId: string,
): Promise<{ id: string } | { error: string }> {
  const { data, error } = await supabase
    .from("product_shorts_plans")
    .select("id, project_id, user_id")
    .eq("id", versionId)
    .maybeSingle();
  if (error || !data) return { error: "버전을 찾을 수 없습니다." };
  if (data.user_id !== userId || data.project_id !== projectId) return { error: "권한이 없습니다." };
  return { id: data.id };
}

export async function loadGenerationState(
  supabase: Client,
  userId: string,
  projectId: string,
  versionId?: string | null,
): Promise<ProductShortsGenerationState | { error: string }> {
  const owned = await assertOwnsProject(supabase, userId, projectId);
  if ("error" in owned) return owned;

  if (versionId) {
    const { data, error } = await supabase
      .from("product_shorts_plans")
      .select("recommendation, selection, plan")
      .eq("id", versionId)
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return { error: "불러오기 실패" };
    if (!data) return { error: "버전을 찾을 수 없습니다." };
    return {
      version: 1,
      recommendation: (data.recommendation as unknown as PhotoRecommendationRun | null) ?? null,
      selection: (data.selection as unknown as PhotoFinalSelection | null) ?? EMPTY_SELECTION,
      plan: (data.plan as unknown as ReelsProject | null) ?? null,
    };
  }

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
    selection: state.selection ?? EMPTY_SELECTION,
    plan: state.plan ?? null,
  };
}

type StatePatch = Partial<Pick<ProductShortsGenerationState, "recommendation" | "selection" | "plan">>;

// Writes ONLY the fields in `patch`. Project mode merges into the existing
// reels_project object so keys this function does not own (angleSuggestions)
// survive; version mode updates just the named columns of that one row.
async function writeState(
  supabase: Client,
  userId: string,
  projectId: string,
  patch: StatePatch,
  versionId?: string | null,
) {
  const owned = await assertOwnsProject(supabase, userId, projectId);
  if ("error" in owned) return owned;

  if (versionId) {
    const update: Database["public"]["Tables"]["product_shorts_plans"]["Update"] = {};
    if ("recommendation" in patch) update.recommendation = patch.recommendation as unknown as Json;
    if ("selection" in patch) update.selection = patch.selection as unknown as Json;
    if ("plan" in patch) update.plan = patch.plan as unknown as Json;
    const { data, error } = await supabase
      .from("product_shorts_plans")
      .update(update)
      .eq("id", versionId)
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .select("id")
      .maybeSingle();
    if (error) return { error: `저장 실패: ${error.message}` };
    if (!data) return { error: "버전을 찾을 수 없습니다." };
    return { success: true as const };
  }

  const { data: row, error: readError } = await supabase
    .from("product_shorts_projects")
    .select("reels_project")
    .eq("id", projectId)
    .maybeSingle();
  if (readError) return { error: "저장 실패" };
  const base = isRecord(row?.reels_project) ? row.reels_project : {};
  const current = await loadGenerationState(supabase, userId, projectId);
  if ("error" in current) return current;
  const next = { ...base, ...current, ...patch, version: 1 };

  const { error } = await supabase
    .from("product_shorts_projects")
    .update({ reels_project: next as unknown as Json })
    .eq("id", projectId);
  if (error) return { error: `저장 실패: ${error.message}` };
  return { success: true as const };
}

export async function saveRecommendation(
  supabase: Client,
  userId: string,
  projectId: string,
  run: PhotoRecommendationRun,
  versionId?: string | null,
) {
  return writeState(supabase, userId, projectId, { recommendation: run }, versionId);
}

export async function saveFinalSelection(
  supabase: Client,
  userId: string,
  projectId: string,
  selection: PhotoFinalSelection,
  versionId?: string | null,
) {
  return writeState(supabase, userId, projectId, { selection }, versionId);
}

export async function savePlan(
  supabase: Client,
  userId: string,
  projectId: string,
  plan: ReelsProject,
  versionId?: string | null,
) {
  return writeState(supabase, userId, projectId, { plan }, versionId);
}

// Studio save (Phase 5): validates the edited ReelsProject against this
// project's real media and the stored plan, then writes ONLY the plan (of the
// project, or of the one version). Refuses when no AI plan exists yet, so the
// studio can never be used to create a plan out of thin air. No AI, no credits.
export async function saveEditedPlan(
  supabase: Client,
  userId: string,
  projectId: string,
  edited: unknown,
  versionId?: string | null,
) {
  const owned = await assertOwnsProject(supabase, userId, projectId);
  if ("error" in owned) return owned;

  const state = await loadGenerationState(supabase, userId, projectId, versionId);
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

  return writeState(supabase, userId, projectId, { plan: result.plan }, versionId);
}

// ---------------------------------------------------------------------------
// Project-level sales-angle / hook suggestions. Stored beside the V1 state in
// reels_project.angleSuggestions (jsonb — no column of its own), so they survive
// a reload without paying for the AI call again.
// ---------------------------------------------------------------------------

export async function loadAngleSuggestions(
  supabase: Client,
  userId: string,
  projectId: string,
): Promise<AngleSuggestionSet | null | { error: string }> {
  const owned = await assertOwnsProject(supabase, userId, projectId);
  if ("error" in owned) return owned;
  const { data, error } = await supabase.from("product_shorts_projects").select("reels_project").eq("id", projectId).maybeSingle();
  if (error) return { error: "불러오기 실패" };
  const raw = data?.reels_project;
  if (!isRecord(raw) || !isRecord(raw.angleSuggestions)) return null;
  const set = raw.angleSuggestions as unknown as AngleSuggestionSet;
  return Array.isArray(set.angles) ? set : null;
}

export async function saveAngleSuggestions(supabase: Client, userId: string, projectId: string, set: AngleSuggestionSet) {
  const owned = await assertOwnsProject(supabase, userId, projectId);
  if ("error" in owned) return owned;
  const { data: row, error: readError } = await supabase.from("product_shorts_projects").select("reels_project").eq("id", projectId).maybeSingle();
  if (readError) return { error: "저장 실패" };
  const base = isRecord(row?.reels_project) ? row.reels_project : { ...emptyGenerationState() };
  const next = { ...base, angleSuggestions: set };
  const { error } = await supabase.from("product_shorts_projects").update({ reels_project: next as unknown as Json }).eq("id", projectId);
  if (error) return { error: `저장 실패: ${error.message}` };
  return { success: true as const };
}
