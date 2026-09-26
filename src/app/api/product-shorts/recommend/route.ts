import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAIProvider } from "@/lib/ai";
import { logAiUsage, classifyErrorType, GENERIC_AI_FAILURE_MESSAGE } from "@/lib/ai/usage";
import { checkAndConsumeAiCredits, refundAiCredits } from "@/lib/ai/usage-limits";
import { OPERATION_CREDIT_COST } from "@/lib/ai/credits";
import { buildProductShortsRecommendPrompt, type ProductShortsAliasedPhoto } from "@/lib/ai/product-shorts-prompts";
import { buildPhotoAliasMap, invertAliasMap } from "@/lib/product-shorts/photo-alias";
import { validateRecommendationResponse } from "@/lib/product-shorts/recommendation-validation";
import { assertOwnsProject, saveRecommendation } from "@/lib/product-shorts/persist";
import type { ProductSource } from "@/lib/product-shorts/types";

// Dedicated route (rather than reusing the generic /api/ai/suggest-order
// as-is). Reason: this call's failure mode includes "AI returned a
// hallucinated/unknown photo alias", which only THIS route can detect (the
// generic route has no idea what an alias is). That check must live inside
// the same try/catch that already does refundAiCredits on any thrown error
// — reusing suggest-order unmodified would consume the credit successfully
// from its point of view and leave no way to trigger the required refund
// for an invalid-alias response (§5/§18). Still charges the existing
// ORDER_SUGGEST operation at its existing 2-credit price — no new
// AiOperation, no price change, and suggest-order/route.ts itself is
// untouched.
const OPERATION = "ORDER_SUGGEST" as const;
const CREDITS_NEEDED = OPERATION_CREDIT_COST.ORDER_SUGGEST;
const MAX_TOKENS = 4096;
const STOP_REASON_MAX_TOKENS = "max_tokens";
const TRUNCATED_ERROR_TYPE = "OUTPUT_TRUNCATED";
const TRUNCATED_USER_MESSAGE =
  "사진이 많아 AI 추천 결과를 완성하지 못했어요.\n사용한 크레딧은 자동으로 복구되었습니다.\n다시 시도해 주세요.";

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

  const { data: mediaRows, error: mediaError } = await supabase
    .from("product_shorts_media")
    .select("id, ai_analysis, display_order")
    .eq("project_id", projectId)
    .order("display_order", { ascending: true });
  if (mediaError || !mediaRows) return NextResponse.json({ error: "사진을 불러오지 못했습니다." }, { status: 500 });

  const analyzedMedia = mediaRows.filter((m) => !!m.ai_analysis);
  if (analyzedMedia.length === 0) {
    return NextResponse.json({ error: "먼저 사진 AI 분석을 완료해주세요." }, { status: 400 });
  }

  const aliasMap = buildPhotoAliasMap(analyzedMedia.map((m) => m.id));
  const aliasToUuid = invertAliasMap(aliasMap);
  const aliasedPhotos: ProductShortsAliasedPhoto[] = analyzedMedia.map((m) => ({
    alias: aliasMap.get(m.id)!,
    description: m.ai_analysis!,
  }));

  const { systemPrompt, prompt, responseSchema } = buildProductShortsRecommendPrompt({
    productSource,
    photos: aliasedPhotos,
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

    const validated = validateRecommendationResponse(
      parsed,
      aliasToUuid,
      analyzedMedia.map((m) => m.id),
    );
    if (!validated.ok) throw new Error(validated.error);

    const saveResult = await saveRecommendation(supabase, user.id, projectId, validated.run);
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

    return NextResponse.json({ recommendation: validated.run });
  } catch (error) {
    await refundAiCredits(supabase, usageCheck.reservationId);
    const truncated = error instanceof OutputTruncatedError;
    const errorType = truncated ? TRUNCATED_ERROR_TYPE : classifyErrorType(error);
    if (truncated) {
      console.error(
        `[/api/product-shorts/recommend] 실패 (${errorType}): inputTokens=${error.inputTokens} outputTokens=${error.outputTokens} maxTokens=${error.maxTokens}`,
      );
    } else {
      console.error(`[/api/product-shorts/recommend] 실패 (${errorType}):`, error);
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
