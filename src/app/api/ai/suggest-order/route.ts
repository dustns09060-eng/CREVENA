import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAIProvider, type ResponseSchema } from "@/lib/ai";
import { logAiUsage, classifyErrorType, GENERIC_AI_FAILURE_MESSAGE } from "@/lib/ai/usage";
import { checkAndConsumeAiCredits, refundAiCredits } from "@/lib/ai/usage-limits";
import { OPERATION_CREDIT_COST } from "@/lib/ai/credits";
import { PhotoAliasError, assertAliasedResponseValid, MAX_PHOTO_ALIAS_COUNT } from "@/lib/ai/photo-alias";

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

// STEP47-1: the provider default (2048) is too small for this route's
// STRUCTURED responses. Measured in a real 20-photo run of "AI로 사진
// 고르기": output_tokens came back as exactly 2048 twice in a row, i.e. the
// tool_use JSON was cut off mid-write. Anthropic still returns the partial
// tool input, so the call "succeeds" and the trailing field of
// photoSelectSchema — `reasons` (per-photo 추천 이유 + 역할) — silently
// arrives empty instead of erroring. With more photos the truncation would
// eat `groups` and `requiredShots` next, which are load-bearing.
//
// max_tokens is a CAP, not a target: the legacy 사진 순서 추천 response
// (~300 output tokens) is unaffected and costs exactly what it did before.
// The 2-credit price of this operation is unchanged and still fixed by the
// route, never by the client — this value is deliberately NOT read from the
// request body.
const MAX_TOKENS = 4096;

// STEP47-2: raising MAX_TOKENS only moves the cliff — a forced tool_use that
// hits the cap is still returned by Anthropic as a normal 200 with a partial
// input, and stop_reason is the only signal. A truncated result must never
// count as a success: it would be parsed, shown, and persisted to
// collaborations.photo_select as if it were complete (empty reasons, missing
// requiredShots), and the 2 credits would be kept. Instead it takes the same
// path as any other failure: credits refunded, usage logged as failed, and
// nothing reaches the client to save.
const STOP_REASON_MAX_TOKENS = "max_tokens";
const TRUNCATED_ERROR_TYPE = "OUTPUT_TRUNCATED";
const TRUNCATED_USER_MESSAGE =
  "사진이 많아 AI 추천 결과를 완성하지 못했어요.\n사용한 크레딧은 자동으로 복구되었습니다.\n다시 시도해 주세요.";

// STEP47-3: photo references in this route's responses are short aliases
// (p1..pN, see src/lib/ai/photo-alias.ts). A response that references an
// alias that doesn't exist, isn't an alias at all, or is structurally broken
// is NOT a success: same path as truncation — refund, failed log, nothing
// for the client to save.
const INVALID_ERROR_TYPE = "OUTPUT_INVALID";
const INVALID_USER_MESSAGE =
  "AI 추천 결과를 확인하지 못했어요.\n사용한 크레딧은 자동으로 복구되었습니다.\n다시 시도해 주세요.";

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
  // Only a bounded positive integer counts; anything else (older cached
  // clients that still send raw ids) simply skips alias validation.
  const aliasCount =
    Number.isInteger(body?.photoAliasCount) && body.photoAliasCount >= 1 && body.photoAliasCount <= MAX_PHOTO_ALIAS_COUNT
      ? (body.photoAliasCount as number)
      : null;

  try {
    const aiProvider = getAIProvider();
    const { content, usage, stopReason } = await aiProvider.generateContent({
      prompt,
      systemPrompt: typeof body?.systemPrompt === "string" ? body.systemPrompt : undefined,
      responseSchema,
      maxTokens: MAX_TOKENS,
    });

    if (stopReason === STOP_REASON_MAX_TOKENS) {
      throw new OutputTruncatedError(usage.inputTokens, usage.outputTokens, MAX_TOKENS);
    }

    if (responseSchema) {
      try {
        JSON.parse(content);
      } catch (parseError) {
        throw new Error(
          `AI 응답 JSON 파싱 실패: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
        );
      }
    }

    if (responseSchema && aliasCount !== null) {
      // Throws PhotoAliasError — handled below like any other failed call.
      assertAliasedResponseValid(responseSchema.name, content, aliasCount);
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
    const truncated = error instanceof OutputTruncatedError;
    const invalid = error instanceof PhotoAliasError;
    const errorType = truncated ? TRUNCATED_ERROR_TYPE : invalid ? INVALID_ERROR_TYPE : classifyErrorType(error);
    if (invalid) {
      // Which part of the response was bad, never its content.
      console.error(`[/api/ai/suggest-order] 실패 (${errorType}): field=${error.field} aliasCount=${aliasCount}`);
    } else if (truncated) {
      // Only numbers — never the partial content, prompt, or photo ids.
      console.error(
        `[/api/ai/suggest-order] 실패 (${errorType}): inputTokens=${error.inputTokens} outputTokens=${error.outputTokens} maxTokens=${error.maxTokens}`,
      );
    } else {
      console.error(`[/api/ai/suggest-order] 실패 (${errorType}):`, error);
    }
    await logAiUsage(supabase, {
      userId: user.id,
      collaborationId,
      feature: "TEXT_GENERATION",
      operation: OPERATION,
      provider,
      model,
      status: "failed",
      errorType,
      // The truncated call was still billed by the provider, so keep its real
      // token counts (credits_used stays 0) for /admin/usage cost visibility.
      inputTokens: truncated ? error.inputTokens : null,
      outputTokens: truncated ? error.outputTokens : null,
      creditsUsed: 0,
    });
    if (invalid) {
      return NextResponse.json({ error: INVALID_USER_MESSAGE }, { status: 422 });
    }
    return NextResponse.json(
      { error: truncated ? TRUNCATED_USER_MESSAGE : GENERIC_AI_FAILURE_MESSAGE },
      { status: truncated ? 422 : 500 },
    );
  }
}
