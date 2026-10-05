import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAIProvider } from "@/lib/ai";
import { logAiUsage, classifyErrorType, GENERIC_AI_FAILURE_MESSAGE } from "@/lib/ai/usage";
import { checkAndConsumeAiCredits, refundAiCredits } from "@/lib/ai/usage-limits";
import { OPERATION_CREDIT_COST } from "@/lib/ai/credits";
import { buildProductShortsAngleHookPrompt } from "@/lib/ai/product-shorts-prompts";
import { validateAnglesResponse, validateHooks } from "@/lib/product-shorts/angle-validation";
import { sourceTextOf } from "@/lib/product-shorts/claim-guard";
import { assertOwnsProject, loadAngleSuggestions, saveAngleSuggestions } from "@/lib/product-shorts/persist";
import type { AngleSuggestionSet } from "@/lib/product-shorts/angle-types";
import type { ProductSource } from "@/lib/product-shorts/types";

// Sales angles + hook candidates (ANGLE_HOOK_SUGGEST, 3 credits per call).
//   mode "angles": 2~5 angles, 10 hooks each, in ONE call (structured JSON).
//   mode "hooks" : regenerate the 10 hooks of ONE existing angle (same price).
// The model's output is validated on the server (counts, styles, lengths,
// unsupported-claim backstop); anything that fails validation is refunded and
// nothing is saved. Product photos are NOT re-analyzed: this only reads the
// ai_analysis text that PHOTO_ANALYSIS already stored.
const OPERATION = "ANGLE_HOOK_SUGGEST" as const;
const CREDITS_NEEDED = OPERATION_CREDIT_COST.ANGLE_HOOK_SUGGEST;
const MAX_TOKENS = 6144;
const STOP_REASON_MAX_TOKENS = "max_tokens";
const TRUNCATED_ERROR_TYPE = "OUTPUT_TRUNCATED";
const TRUNCATED_USER_MESSAGE =
  "AI 결과를 끝까지 완성하지 못했어요.\n사용한 크레딧은 자동으로 복구되었습니다.\n다시 시도해 주세요.";

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
  const mode = body?.mode === "hooks" ? "hooks" : "angles";
  const angleId = body?.angleId;
  if (typeof projectId !== "string") return NextResponse.json({ error: "projectId는 필수입니다." }, { status: 400 });
  if (mode === "hooks" && typeof angleId !== "string") {
    return NextResponse.json({ error: "angleId는 필수입니다." }, { status: 400 });
  }

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
    .select("ai_analysis, display_order")
    .eq("project_id", projectId)
    .order("display_order", { ascending: true });
  if (mediaError || !mediaRows) return NextResponse.json({ error: "사진을 불러오지 못했습니다." }, { status: 500 });
  const photoDescriptions = mediaRows.map((m) => m.ai_analysis).filter((d): d is string => !!d);
  if (photoDescriptions.length === 0) {
    return NextResponse.json({ error: "먼저 사진 AI 분석을 완료해주세요." }, { status: 400 });
  }

  let existing: AngleSuggestionSet | null = null;
  let targetAngleIndex = -1;
  if (mode === "hooks") {
    const loaded = await loadAngleSuggestions(supabase, user.id, projectId);
    if (loaded && "error" in loaded) return NextResponse.json({ error: loaded.error }, { status: 500 });
    existing = loaded;
    targetAngleIndex = existing ? existing.angles.findIndex((a) => a.id === angleId) : -1;
    if (!existing || targetAngleIndex < 0) {
      return NextResponse.json({ error: "판매각도를 찾을 수 없습니다." }, { status: 404 });
    }
  }

  const { systemPrompt, prompt, responseSchema } = buildProductShortsAngleHookPrompt({
    productSource,
    photoDescriptions,
    onlyAngle:
      mode === "hooks" && existing
        ? {
            type: existing.angles[targetAngleIndex].type,
            title: existing.angles[targetAngleIndex].title,
            rationale: existing.angles[targetAngleIndex].rationale,
          }
        : null,
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

    const sourceText = sourceTextOf(productSource);
    let result: AngleSuggestionSet;
    if (mode === "hooks" && existing) {
      const validated = validateHooks((parsed as { hooks?: unknown } | null)?.hooks, sourceText);
      if (!validated.ok) throw new Error(validated.error);
      // Only this angle's hooks change; every other angle is carried over untouched.
      result = {
        generatedAt: existing.generatedAt,
        angles: existing.angles.map((a, i) => (i === targetAngleIndex ? { ...a, hooks: validated.hooks } : a)),
      };
    } else {
      const validated = validateAnglesResponse(parsed, sourceText, !!productSource.priceText);
      if (!validated.ok) throw new Error(validated.error);
      result = { generatedAt: new Date().toISOString(), angles: validated.angles };
    }

    const saveResult = await saveAngleSuggestions(supabase, user.id, projectId, result);
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

    return NextResponse.json({ suggestions: result });
  } catch (error) {
    await refundAiCredits(supabase, usageCheck.reservationId);
    const truncated = error instanceof OutputTruncatedError;
    const errorType = truncated ? TRUNCATED_ERROR_TYPE : classifyErrorType(error);
    console.error(`[/api/product-shorts/angles] 실패 (${errorType}):`, error);
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
