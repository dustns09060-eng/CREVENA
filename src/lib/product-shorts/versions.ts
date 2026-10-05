// Shopping Shorts "versions": up to three independent A/B/C short-form plans
// for one product, one row each in product_shorts_plans.
//
// The angle and hook of a version are copied from the SERVER-STORED suggestions
// (reels_project.angleSuggestions) by id — the client only says which angle and
// which hook it picked, never what they say.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import {
  MAX_VERSIONS,
  VERSION_LABELS,
  type VersionAngle,
  type VersionLabel,
} from "./angle-types";
import { assertOwnsProject, assertOwnsVersion, loadAngleSuggestions } from "./persist";
import type { ProductShortsGenerationState } from "./recommendation-types";

type Client = SupabaseClient<Database>;

export type ProductShortsVersion = {
  id: string;
  label: VersionLabel;
  angle: VersionAngle;
  hook: string;
  state: ProductShortsGenerationState;
};

function isLabel(v: string): v is VersionLabel {
  return (VERSION_LABELS as readonly string[]).includes(v);
}

function toAngle(raw: unknown): VersionAngle {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    type: (o.type as VersionAngle["type"]) ?? "FEATURE",
    title: typeof o.title === "string" ? o.title : "",
    rationale: typeof o.rationale === "string" ? o.rationale : "",
  };
}

export async function listVersions(
  supabase: Client,
  userId: string,
  projectId: string,
): Promise<ProductShortsVersion[] | { error: string }> {
  const owned = await assertOwnsProject(supabase, userId, projectId);
  if ("error" in owned) return owned;

  const { data, error } = await supabase
    .from("product_shorts_plans")
    .select("id, label, angle, hook, recommendation, selection, plan")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .order("label", { ascending: true });
  if (error || !data) return { error: "버전을 불러오지 못했어요." };

  return data
    .filter((row) => isLabel(row.label))
    .map((row) => ({
      id: row.id,
      label: row.label as VersionLabel,
      angle: toAngle(row.angle),
      hook: row.hook,
      state: {
        version: 1 as const,
        recommendation: (row.recommendation as unknown as ProductShortsGenerationState["recommendation"]) ?? null,
        selection: (row.selection as unknown as ProductShortsGenerationState["selection"]) ?? {
          pinnedIds: [],
          excludedIds: [],
          includedIds: [],
          coverMediaId: null,
        },
        plan: (row.plan as unknown as ProductShortsGenerationState["plan"]) ?? null,
      },
    }));
}

export async function createVersion(
  supabase: Client,
  userId: string,
  projectId: string,
  pick: { angleId: string; hookId: string },
): Promise<{ id: string; label: VersionLabel } | { error: string }> {
  const owned = await assertOwnsProject(supabase, userId, projectId);
  if ("error" in owned) return owned;

  const suggestions = await loadAngleSuggestions(supabase, userId, projectId);
  if (suggestions && "error" in suggestions) return suggestions;
  if (!suggestions) return { error: "먼저 판매각도를 만들어주세요." };

  const angle = suggestions.angles.find((a) => a.id === pick.angleId);
  const hook = angle?.hooks.find((h) => h.id === pick.hookId);
  if (!angle || !hook) return { error: "선택한 판매각도나 후킹을 찾을 수 없어요." };

  const { data: existing, error: listError } = await supabase
    .from("product_shorts_plans")
    .select("label")
    .eq("project_id", projectId)
    .eq("user_id", userId);
  if (listError) return { error: "버전을 확인하지 못했어요." };
  const used = new Set((existing ?? []).map((r) => r.label));
  if (used.size >= MAX_VERSIONS) return { error: `버전은 최대 ${MAX_VERSIONS}개까지 만들 수 있어요.` };
  const label = VERSION_LABELS.find((l) => !used.has(l));
  if (!label) return { error: `버전은 최대 ${MAX_VERSIONS}개까지 만들 수 있어요.` };

  const versionAngle: VersionAngle = { type: angle.type, title: angle.title, rationale: angle.rationale };
  const { data, error } = await supabase
    .from("product_shorts_plans")
    .insert({
      project_id: projectId,
      user_id: userId,
      label,
      angle: versionAngle as unknown as Json,
      hook: hook.text,
    })
    .select("id")
    .single();
  if (error || !data) {
    // unique (project_id, label): two simultaneous creates picked the same label.
    return { error: "버전을 만들지 못했어요. 잠시 후 다시 시도해주세요." };
  }
  return { id: data.id, label };
}

export async function deleteVersion(supabase: Client, userId: string, projectId: string, versionId: string) {
  const owned = await assertOwnsVersion(supabase, userId, projectId, versionId);
  if ("error" in owned) return owned;
  const { error } = await supabase
    .from("product_shorts_plans")
    .delete()
    .eq("id", versionId)
    .eq("project_id", projectId)
    .eq("user_id", userId);
  if (error) return { error: "버전을 삭제하지 못했어요." };
  return { success: true as const };
}

// The angle + hook of one version (for the recommend / plan prompts).
export async function loadVersionContext(
  supabase: Client,
  userId: string,
  projectId: string,
  versionId: string,
): Promise<{ angle: VersionAngle; hook: string } | { error: string }> {
  const { data, error } = await supabase
    .from("product_shorts_plans")
    .select("angle, hook")
    .eq("id", versionId)
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return { error: "버전을 찾을 수 없습니다." };
  return { angle: toAngle(data.angle), hook: data.hook };
}

