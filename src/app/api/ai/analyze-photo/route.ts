import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAIProvider } from "@/lib/ai";
import { logAiUsage, classifyErrorType } from "@/lib/ai/usage";
import { checkAndConsumeAiCredits, refundAiCredits } from "@/lib/ai/usage-limits";
import { buildPhotoAnalysisPrompt, parseJsonResponse } from "@/lib/ai/photo-blog-prompts";
import { PHOTO_TYPES } from "@/lib/photo-type";
import { OPERATION_CREDIT_COST } from "@/lib/ai/credits";
import type { PhotoType } from "@/types/database";

const BUCKET = "collaboration-photos";
const CREDITS_NEEDED = OPERATION_CREDIT_COST.PHOTO_ANALYSIS;

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const photoId = body?.photoId;
  if (typeof photoId !== "string") {
    return NextResponse.json({ error: "photoId는 필수입니다." }, { status: 400 });
  }

  const { data: photo, error: photoError } = await supabase
    .from("collaboration_photos")
    .select("id, collaboration_id, storage_path")
    .eq("id", photoId)
    .maybeSingle();

  if (photoError || !photo) {
    return NextResponse.json({ error: "사진을 찾을 수 없습니다." }, { status: 404 });
  }

  const { data: profile } = await supabase
    .from("users")
    .select("plan_tier")
    .eq("id", user.id)
    .maybeSingle();

  const provider = process.env.AI_PROVIDER ?? "claude";
  const model = process.env.ANTHROPIC_MODEL ?? null;

  const usageCheck = await checkAndConsumeAiCredits(supabase, user.id, profile?.plan_tier, CREDITS_NEEDED);
  if (!usageCheck.allowed) {
    await logAiUsage(supabase, {
      userId: user.id,
      collaborationId: photo.collaboration_id,
      feature: "VISION_ANALYSIS",
      operation: "PHOTO_ANALYSIS",
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

  const { data: fileBlob, error: downloadError } = await supabase.storage
    .from(BUCKET)
    .download(photo.storage_path);

  if (downloadError || !fileBlob) {
    return NextResponse.json({ error: `이미지를 불러오지 못했습니다: ${downloadError?.message}` }, { status: 500 });
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
      throw new Error(
        `AI 응답 JSON 파싱 실패: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
      );
    }
    const photoType: PhotoType = PHOTO_TYPES.includes(parsed.photo_type as PhotoType)
      ? (parsed.photo_type as PhotoType)
      : "OTHER";

    await supabase
      .from("collaboration_photos")
      .update({ photo_type: photoType, ai_analysis: parsed.description })
      .eq("id", photoId);

    await logAiUsage(supabase, {
      userId: user.id,
      collaborationId: photo.collaboration_id,
      feature: "VISION_ANALYSIS",
      operation: "PHOTO_ANALYSIS",
      provider,
      model,
      status: "success",
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      creditsUsed: CREDITS_NEEDED,
    });

    return NextResponse.json({ photoType, description: parsed.description });
  } catch (error) {
    await refundAiCredits(supabase, usageCheck.reservationId);
    const errorType = classifyErrorType(error);
    console.error(`[/api/ai/analyze-photo] 실패 (${errorType}):`, error);
    const message =
      errorType === "PARSE_ERROR"
        ? "콘텐츠 생성 중 형식 오류가 발생했습니다. 다시 시도해주세요."
        : error instanceof Error
          ? error.message
          : "사진 분석에 실패했습니다.";
    await logAiUsage(supabase, {
      userId: user.id,
      collaborationId: photo.collaboration_id,
      feature: "VISION_ANALYSIS",
      operation: "PHOTO_ANALYSIS",
      provider,
      model,
      status: "failed",
      errorType,
      creditsUsed: 0,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
