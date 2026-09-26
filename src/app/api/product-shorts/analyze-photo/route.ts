import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAIProvider } from "@/lib/ai";
import { logAiUsage, classifyErrorType, GENERIC_AI_FAILURE_MESSAGE } from "@/lib/ai/usage";
import { checkAndConsumeAiCredits, refundAiCredits } from "@/lib/ai/usage-limits";
import { buildPhotoAnalysisPrompt, parseJsonResponse } from "@/lib/ai/photo-blog-prompts";
import { OPERATION_CREDIT_COST } from "@/lib/ai/credits";
import { assertOwnsProject, assertOwnsMedia } from "@/lib/product-shorts/persist";

// Product-Shorts-specific PHOTO_ANALYSIS route — NOT a modification of
// /api/ai/analyze-photo, which is hardwired to collaboration_photos /
// collaboration-photos bucket and stays untouched. This route writes into
// product_shorts_media.ai_analysis instead, reusing the same
// buildPhotoAnalysisPrompt()/parseJsonResponse and the same PHOTO_ANALYSIS
// operation/price (1 credit) — only photo_type classification is discarded
// since product_shorts_media has no such column.
const BUCKET = "product-shorts-media";
const CREDITS_NEEDED = OPERATION_CREDIT_COST.PHOTO_ANALYSIS;

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const projectId = body?.projectId;
  const mediaId = body?.mediaId;
  if (typeof projectId !== "string" || typeof mediaId !== "string") {
    return NextResponse.json({ error: "projectId/mediaId는 필수입니다." }, { status: 400 });
  }

  const project = await assertOwnsProject(supabase, user.id, projectId);
  if ("error" in project) return NextResponse.json({ error: project.error }, { status: 403 });

  const media = await assertOwnsMedia(supabase, user.id, projectId, mediaId);
  if ("error" in media) return NextResponse.json({ error: media.error }, { status: 403 });

  // Already analyzed -> skip, no credit charge (§2 default: 재분석하지 않음).
  if (media.aiAnalysis) {
    return NextResponse.json({ description: media.aiAnalysis, skipped: true as const });
  }

  const { data: profile } = await supabase.from("users").select("plan_tier").eq("id", user.id).maybeSingle();
  const provider = process.env.AI_PROVIDER ?? "claude";
  const model = process.env.ANTHROPIC_MODEL ?? null;

  const usageCheck = await checkAndConsumeAiCredits(supabase, user.id, profile?.plan_tier, CREDITS_NEEDED);
  if (!usageCheck.allowed) {
    await logAiUsage(supabase, {
      userId: user.id,
      collaborationId: null,
      feature: "VISION_ANALYSIS",
      operation: "PHOTO_ANALYSIS",
      provider,
      model,
      status: "failed",
      errorType: usageCheck.reason,
      creditsUsed: 0,
    });
    return NextResponse.json({ error: usageCheck.message, reason: usageCheck.reason }, { status: 429 });
  }

  const { data: fileBlob, error: downloadError } = await supabase.storage.from(BUCKET).download(media.storagePath);
  if (downloadError || !fileBlob) {
    await refundAiCredits(supabase, usageCheck.reservationId);
    if (downloadError) console.error("product-shorts/analyze-photo: storage download failed", downloadError.message);
    return NextResponse.json({ error: "이미지를 불러오지 못했습니다. 잠시 후 다시 시도해주세요." }, { status: 500 });
  }

  try {
    const buffer = await fileBlob.arrayBuffer();
    const base64Data = Buffer.from(buffer).toString("base64");

    const aiProvider = getAIProvider();
    const { systemPrompt, prompt, responseSchema } = buildPhotoAnalysisPrompt();
    const { content: raw, usage } = await aiProvider.generateContent({
      systemPrompt,
      prompt,
      images: [{ mediaType: "image/jpeg", base64Data }],
      responseSchema,
    });

    let parsed: { photo_type: string; description: string };
    try {
      parsed = parseJsonResponse<{ photo_type: string; description: string }>(raw);
    } catch (parseError) {
      throw new Error(`AI 응답 JSON 파싱 실패: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
    }

    const { error: updateError } = await supabase
      .from("product_shorts_media")
      .update({ ai_analysis: parsed.description })
      .eq("id", mediaId);
    if (updateError) throw new Error(`저장 실패: ${updateError.message}`);

    await logAiUsage(supabase, {
      userId: user.id,
      collaborationId: null,
      feature: "VISION_ANALYSIS",
      operation: "PHOTO_ANALYSIS",
      provider,
      model,
      status: "success",
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      creditsUsed: CREDITS_NEEDED,
    });

    return NextResponse.json({ description: parsed.description, skipped: false as const });
  } catch (error) {
    await refundAiCredits(supabase, usageCheck.reservationId);
    const errorType = classifyErrorType(error);
    console.error(`[/api/product-shorts/analyze-photo] 실패 (${errorType}):`, error);
    await logAiUsage(supabase, {
      userId: user.id,
      collaborationId: null,
      feature: "VISION_ANALYSIS",
      operation: "PHOTO_ANALYSIS",
      provider,
      model,
      status: "failed",
      errorType,
      creditsUsed: 0,
    });
    return NextResponse.json({ error: GENERIC_AI_FAILURE_MESSAGE }, { status: 500 });
  }
}
