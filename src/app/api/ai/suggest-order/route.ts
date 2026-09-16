import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAIProvider, type ResponseSchema } from "@/lib/ai";
import { logAiUsage, classifyErrorType } from "@/lib/ai/usage";
import { checkAndConsumeAiCredits, refundAiCredits } from "@/lib/ai/usage-limits";
import { OPERATION_CREDIT_COST } from "@/lib/ai/credits";

function isResponseSchema(value: unknown): value is ResponseSchema {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as ResponseSchema).name === "string" &&
    typeof (value as ResponseSchema).schema === "object"
  );
}

// Dedicated route (instead of sharing /api/ai/generate) so the 2-credit cost
// of "사진 순서 추천" is fixed by which endpoint was called, not by a
// client-sent operation label — a client can't relabel this as a 1-credit
// call to pay less. Otherwise mirrors /api/ai/generate exactly.
const OPERATION = "ORDER_SUGGEST" as const;
const CREDITS_NEEDED = OPERATION_CREDIT_COST.ORDER_SUGGEST;

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const prompt = body?.prompt;
  if (typeof prompt !== "string" || prompt.trim() === "") {
    return NextResponse.json({ error: "prompt는 필수입니다." }, { status: 400 });
  }

  const { data: profile } = await supabase
    .from("users")
    .select("plan_tier")
    .eq("id", user.id)
    .maybeSingle();

  const collaborationId = typeof body?.collaborationId === "string" ? body.collaborationId : null;
  const provider = process.env.AI_PROVIDER ?? "claude";
  const model = process.env.ANTHROPIC_MODEL ?? null;

  const usageCheck = await checkAndConsumeAiCredits(supabase, user.id, profile?.plan_tier, CREDITS_NEEDED);
  if (!usageCheck.allowed) {
    await logAiUsage(supabase, {
      userId: user.id,
      collaborationId,
      feature: "TEXT_GENERATION",
      operation: OPERATION,
      provider,
      model,
      status: "failed",
      errorType: usageCheck.reason,
      creditsUsed: 0,
    });
    return NextResponse.json(
      { error: usageCheck.message, reason: usageCheck.reason },
      { status: 429 },
    );
  }

  const responseSchema = isResponseSchema(body?.responseSchema) ? body.responseSchema : undefined;

  try {
    const aiProvider = getAIProvider();
    const { content, usage } = await aiProvider.generateContent({
      prompt,
      systemPrompt: typeof body?.systemPrompt === "string" ? body.systemPrompt : undefined,
      responseSchema,
    });

    if (responseSchema) {
      try {
        JSON.parse(content);
      } catch (parseError) {
        throw new Error(
          `AI 응답 JSON 파싱 실패: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
        );
      }
    }

    await logAiUsage(supabase, {
      userId: user.id,
      collaborationId,
      feature: "TEXT_GENERATION",
      operation: OPERATION,
      provider,
      model,
      status: "success",
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      creditsUsed: CREDITS_NEEDED,
    });
    return NextResponse.json({ content });
  } catch (error) {
    await refundAiCredits(supabase, usageCheck.reservationId);
    const errorType = classifyErrorType(error);
    console.error(`[/api/ai/suggest-order] 실패 (${errorType}):`, error);
    const message =
      errorType === "PARSE_ERROR"
        ? "콘텐츠 생성 중 형식 오류가 발생했습니다. 다시 시도해주세요."
        : error instanceof Error
          ? error.message
          : "사진 순서 추천에 실패했습니다.";
    await logAiUsage(supabase, {
      userId: user.id,
      collaborationId,
      feature: "TEXT_GENERATION",
      operation: OPERATION,
      provider,
      model,
      status: "failed",
      errorType,
      creditsUsed: 0,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
