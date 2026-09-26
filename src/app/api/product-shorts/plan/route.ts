import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAIProvider } from "@/lib/ai";
import { logAiUsage, classifyErrorType, GENERIC_AI_FAILURE_MESSAGE } from "@/lib/ai/usage";
import { checkAndConsumeAiCredits, refundAiCredits } from "@/lib/ai/usage-limits";
import { OPERATION_CREDIT_COST } from "@/lib/ai/credits";
import { buildProductShortsPlanPrompt, type ProductShortsAliasedPhoto } from "@/lib/ai/product-shorts-prompts";
import { buildPhotoAliasMap, invertAliasMap } from "@/lib/product-shorts/photo-alias";
import { validateProductShortsPlan } from "@/lib/product-shorts/plan-validation";
import { assertOwnsProject, savePlan, loadGenerationState } from "@/lib/product-shorts/persist";
import type { ProductSource } from "@/lib/product-shorts/types";
import type { ReelsProject } from "@/app/(app)/collaborations/[id]/reels/actions";

// Dedicated route (rather than reusing the shared /api/ai/reels-plan, which
// stays untouched to avoid any regression risk to ReelsStudio/Naver Clip).
// Still charges the existing REELS_PLAN operation at its existing 5-credit
// price — no new AiOperation, no price change — it only adds the
// truncation-defense pattern (copied from /api/ai/suggest-order) that the
// shared reels-plan route currently lacks, plus Product-Shorts-specific
// server-side plan validation (§14) before persisting anything.
const OPERATION = "REELS_PLAN" as const;
const CREDITS_NEEDED = OPERATION_CREDIT_COST.REELS_PLAN;
const MAX_TOKENS = 4096;
const STOP_REASON_MAX_TOKENS = "max_tokens";
const TRUNCATED_ERROR_TYPE = "OUTPUT_TRUNCATED";
const TRUNCATED_USER_MESSAGE =
  "사진이 많아 숏츠 구성 결과를 완성하지 못했어요.\n사용한 크레딧은 자동으로 복구되었습니다.\n다시 시도해 주세요.";

class OutputTruncatedError extends Error {
  constructor(
    readonly inputTokens: number,
    readonly outputTokens: number,
    readonly maxTokens: number,
  ) {
    super("AI 응답이 max_tokens 한도에서 잘림");
    this.name = "OutputTruncatedError";
  }
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const projectId = body?.projectId;
  if (typeof projectId !== "string") return NextResponse.json({ error: "projectId는 필수입니다." }, { status: 400 });

  const project = await assertOwnsProject(supabase, user.id, projectId);
  if ("error" in project) return NextResponse.json({ error: project.error }, { status: 403 });

  const { data: projectRow } = await supabase
    .from("product_shorts_projects")
    .select("product_source")
    .eq("id", projectId)
    .maybeSingle();
  if (!projectRow) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다." }, { status: 404 });
  const productSource = projectRow.product_source as unknown as ProductSource;

  const state = await loadGenerationState(supabase, user.id, projectId);
  if ("error" in state) return NextResponse.json({ error: state.error }, { status: 403 });

  const finalSelectedIds = state.selection.includedIds.filter((id) => !state.selection.excludedIds.includes(id));
  if (finalSelectedIds.length === 0) {
    return NextResponse.json({ error: "먼저 사용할 사진을 선택해주세요." }, { status: 400 });
  }

  const { data: mediaRows, error: mediaError } = await supabase
    .from("product_shorts_media")
    .select("id, ai_analysis, display_order")
    .eq("project_id", projectId)
    .in("id", finalSelectedIds);
  if (mediaError || !mediaRows) return NextResponse.json({ error: "사진을 불러오지 못했습니다." }, { status: 500 });

  // Preserve the user's chosen order (finalSelectedIds), not DB order.
  const byId = new Map(mediaRows.map((m) => [m.id, m]));
  const orderedMedia = finalSelectedIds.map((id) => byId.get(id)).filter((m): m is NonNullable<typeof m> => !!m);
  if (orderedMedia.some((m) => !m.ai_analysis)) {
    return NextResponse.json({ error: "선택된 사진 중 아직 AI 분석이 완료되지 않은 사진이 있습니다." }, { status: 400 });
  }

  const aliasMap = buildPhotoAliasMap(orderedMedia.map((m) => m.id));
  const aliasToUuid = invertAliasMap(aliasMap);
  const aliasedPhotos: ProductShortsAliasedPhoto[] = orderedMedia.map((m) => ({
    alias: aliasMap.get(m.id)!,
    description: m.ai_analysis!,
  }));

  const targetDurationSeconds = project.targetDurationSeconds;
  const { systemPrompt, prompt, responseSchema } = buildProductShortsPlanPrompt({
    productSource,
    targetDurationSeconds,
    selectedPhotos: aliasedPhotos,
  });

  const { data: profile } = await supabase.from("users").select("plan_tier").eq("id", user.id).maybeSingle();
  const provider = process.env.AI_PROVIDER ?? "claude";
  const model = process.env.ANTHROPIC_MODEL ?? null;

  const usageCheck = await checkAndConsumeAiCredits(supabase, user.id, profile?.plan_tier, CREDITS_NEEDED);
  if (!usageCheck.allowed) {
    await logAiUsage(supabase, {
      userId: user.id,
      collaborationId: null,
      feature: "TEXT_GENERATION",
      operation: OPERATION,
      provider,
      model,
      status: "failed",
      errorType: usageCheck.reason,
      creditsUsed: 0,
    });
    return NextResponse.json({ error: usageCheck.message, reason: usageCheck.reason }, { status: 429 });
  }

  try {
    const aiProvider = getAIProvider();
    const { content, usage, stopReason } = await aiProvider.generateContent({
      systemPrompt,
      prompt,
      responseSchema,
      maxTokens: MAX_TOKENS,
    });

    if (stopReason === STOP_REASON_MAX_TOKENS) {
      throw new OutputTruncatedError(usage.inputTokens, usage.outputTokens, MAX_TOKENS);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (parseError) {
      throw new Error(`AI 응답 JSON 파싱 실패: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
    }

    const validated = validateProductShortsPlan(parsed, aliasToUuid, new Set(finalSelectedIds), targetDurationSeconds);
    if (!validated.ok) {
      throw new Error(validated.error);
    }

    const reelsProject: ReelsProject = {
      scenes: validated.scenes.map((s, i) =>
        i === 0
          ? { ...s, caption: validated.hook || s.caption }
          : i === validated.scenes.length - 1
            ? { ...s, caption: validated.ctaText || s.caption }
            : s,
      ),
      targetDurationSeconds,
      captionStyle: { preset: "basic", position: "bottom", size: "medium" },
    };

    const saveResult = await savePlan(supabase, user.id, projectId, reelsProject);
    if ("error" in saveResult) throw new Error(saveResult.error);

    await logAiUsage(supabase, {
      userId: user.id,
      collaborationId: null,
      feature: "TEXT_GENERATION",
      operation: OPERATION,
      provider,
      model,
      status: "success",
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      creditsUsed: CREDITS_NEEDED,
    });

    return NextResponse.json({ plan: reelsProject });
  } catch (error) {
    await refundAiCredits(supabase, usageCheck.reservationId);
    const truncated = error instanceof OutputTruncatedError;
    const errorType = truncated ? TRUNCATED_ERROR_TYPE : classifyErrorType(error);
    if (truncated) {
      console.error(
        `[/api/product-shorts/plan] 실패 (${errorType}): inputTokens=${error.inputTokens} outputTokens=${error.outputTokens} maxTokens=${error.maxTokens}`,
      );
    } else {
      console.error(`[/api/product-shorts/plan] 실패 (${errorType}):`, error);
    }
    await logAiUsage(supabase, {
      userId: user.id,
      collaborationId: null,
      feature: "TEXT_GENERATION",
      operation: OPERATION,
      provider,
      model,
      status: "failed",
      errorType,
      inputTokens: truncated ? error.inputTokens : null,
      outputTokens: truncated ? error.outputTokens : null,
      creditsUsed: 0,
    });
    return NextResponse.json(
      { error: truncated ? TRUNCATED_USER_MESSAGE : GENERIC_AI_FAILURE_MESSAGE },
      { status: truncated ? 422 : 500 },
    );
  }
}
