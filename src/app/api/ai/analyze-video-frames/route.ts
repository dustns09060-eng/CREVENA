import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAIProvider } from "@/lib/ai";
import { logAiUsage, classifyErrorType, GENERIC_AI_FAILURE_MESSAGE } from "@/lib/ai/usage";
import { checkAndConsumeAiCredits, refundAiCredits } from "@/lib/ai/usage-limits";
import { buildVideoFrameAnalysisPrompt, parseJsonResponse } from "@/lib/ai/reels-prompts";
import { OPERATION_CREDIT_COST } from "@/lib/ai/credits";
import type { ImageInput } from "@/lib/ai/types";

// STEP39 item 6: analyzes 2-3 client-extracted representative frames of one
// video clip in a single Vision call — the raw video file is never sent to
// or touched by this route. Same credit-reservation/refund/logging shape as
// /api/ai/analyze-photo.
const CREDITS_NEEDED = OPERATION_CREDIT_COST.VIDEO_FRAME_ANALYZE;
const MAX_FRAMES = 3;

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const videoId = body?.videoId;
  const frames = body?.frames as { timestampSeconds: number; base64Data: string }[] | undefined;

  if (typeof videoId !== "string" || !Array.isArray(frames) || frames.length === 0) {
    return NextResponse.json({ error: "videoId와 frames는 필수입니다." }, { status: 400 });
  }
  if (frames.length > MAX_FRAMES) {
    return NextResponse.json({ error: `프레임은 최대 ${MAX_FRAMES}장까지 분석할 수 있습니다.` }, { status: 400 });
  }

  const { data: video, error: videoError } = await supabase
    .from("collaboration_videos")
    .select("id, collaboration_id")
    .eq("id", videoId)
    .maybeSingle();

  if (videoError || !video) {
    return NextResponse.json({ error: "영상을 찾을 수 없습니다." }, { status: 404 });
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
      collaborationId: video.collaboration_id,
      feature: "VISION_ANALYSIS",
      operation: "VIDEO_FRAME_ANALYZE",
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
    const images: ImageInput[] = frames.map((f) => ({ mediaType: "image/jpeg", base64Data: f.base64Data }));
    const { systemPrompt, prompt, responseSchema } = buildVideoFrameAnalysisPrompt(
      frames.map((f) => f.timestampSeconds),
    );
    const aiProvider = getAIProvider();
    const { content: raw, usage } = await aiProvider.generateContent({
      systemPrompt,
      prompt,
      images,
      responseSchema,
    });

    const parsed = parseJsonResponse<{ frames: { description: string }[]; summary: string }>(raw);
    const frameAnalysis = frames.map((f, i) => ({
      timestampSeconds: f.timestampSeconds,
      description: parsed.frames[i]?.description ?? "",
    }));

    await supabase
      .from("collaboration_videos")
      .update({ frame_analysis: { frames: frameAnalysis, summary: parsed.summary } as never })
      .eq("id", videoId);

    await logAiUsage(supabase, {
      userId: user.id,
      collaborationId: video.collaboration_id,
      feature: "VISION_ANALYSIS",
      operation: "VIDEO_FRAME_ANALYZE",
      provider,
      model,
      status: "success",
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      creditsUsed: CREDITS_NEEDED,
    });

    return NextResponse.json({ frames: frameAnalysis, summary: parsed.summary });
  } catch (error) {
    await refundAiCredits(supabase, usageCheck.reservationId);
    const errorType = classifyErrorType(error);
    console.error(`[/api/ai/analyze-video-frames] 실패 (${errorType}):`, error);
    await logAiUsage(supabase, {
      userId: user.id,
      collaborationId: video.collaboration_id,
      feature: "VISION_ANALYSIS",
      operation: "VIDEO_FRAME_ANALYZE",
      provider,
      model,
      status: "failed",
      errorType,
      creditsUsed: 0,
    });
    return NextResponse.json({ error: GENERIC_AI_FAILURE_MESSAGE }, { status: 500 });
  }
}
