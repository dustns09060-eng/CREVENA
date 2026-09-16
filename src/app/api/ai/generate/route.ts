import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAIProvider } from "@/lib/ai";
import { logAiUsage, classifyErrorType } from "@/lib/ai/usage";
import { checkAndConsumeAiCredits, refundAiCredits } from "@/lib/ai/usage-limits";
import { OPERATION_CREDIT_COST, type AiOperation } from "@/lib/ai/credits";

// This route only ever serves operations that cost the same 1 credit, so
// the cost is fixed here rather than trusted from the client. Anything
// pricier (ORDER_SUGGEST, BLOG_WRITE) has its own dedicated route below so a
// client can't relabel an expensive call as one of these to pay less.
const ALLOWED_OPERATIONS: AiOperation[] = ["CONTENT_GENERATE", "GUIDE_CHECK", "PARAGRAPH_REGENERATE"];
const CREDITS_NEEDED = OPERATION_CREDIT_COST.CONTENT_GENERATE;

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
  // operation is informational only (which button the user clicked, for
  // admin stats) — it never affects the credit cost, which is fixed above.
  const rawOperation = typeof body?.operation === "string" ? body.operation : null;
  const operation = ALLOWED_OPERATIONS.includes(rawOperation as AiOperation) ? rawOperation : null;
  const provider = process.env.AI_PROVIDER ?? "claude";
  const model = process.env.ANTHROPIC_MODEL ?? null;

  const usageCheck = await checkAndConsumeAiCredits(supabase, user.id, profile?.plan_tier, CREDITS_NEEDED);
  if (!usageCheck.allowed) {
    await logAiUsage(supabase, {
      userId: user.id,
      collaborationId,
      feature: "TEXT_GENERATION",
      operation,
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

  try {
    const aiProvider = getAIProvider();
    const maxTokens =
      typeof body?.maxTokens === "number" && body.maxTokens > 0 ? body.maxTokens : undefined;
    const { content, usage } = await aiProvider.generateContent({
      prompt,
      systemPrompt: typeof body?.systemPrompt === "string" ? body.systemPrompt : undefined,
      maxTokens,
    });
    await logAiUsage(supabase, {
      userId: user.id,
      collaborationId,
      feature: "TEXT_GENERATION",
      operation,
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
    const message = error instanceof Error ? error.message : "AI 콘텐츠 생성에 실패했습니다.";
    await logAiUsage(supabase, {
      userId: user.id,
      collaborationId,
      feature: "TEXT_GENERATION",
      operation,
      provider,
      model,
      status: "failed",
      errorType: classifyErrorType(error),
      creditsUsed: 0,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
