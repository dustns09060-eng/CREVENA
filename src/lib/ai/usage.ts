import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, AiUsageFeature } from "@/types/database";

export async function logAiUsage(
  supabase: SupabaseClient<Database>,
  params: {
    userId: string;
    collaborationId?: string | null;
    feature: AiUsageFeature;
    operation?: string | null;
    provider: string;
    model?: string | null;
    unitCount?: number;
    status: "success" | "failed";
    errorType?: string | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
    // Credits actually kept for this call: the reserved amount on success,
    // 0 on a rejected (quota/rate-limit) or failed call (refunded). Left
    // undefined/null for call sites that predate STEP24 — never backfilled.
    creditsUsed?: number | null;
  },
) {
  await supabase.from("ai_usage_logs").insert({
    user_id: params.userId,
    collaboration_id: params.collaborationId ?? null,
    feature: params.feature,
    operation: params.operation ?? null,
    provider: params.provider,
    model: params.model ?? null,
    unit_count: params.unitCount ?? 1,
    status: params.status,
    error_type: params.errorType ?? null,
    input_tokens: params.inputTokens ?? null,
    output_tokens: params.outputTokens ?? null,
    credits_used: params.creditsUsed ?? null,
  });
}

export function classifyErrorType(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("ANTHROPIC_API_KEY") || message.includes("환경변수")) return "MISSING_API_KEY";
  if (message.includes("429")) return "RATE_LIMITED";
  if (message.includes("401") || message.includes("403")) return "AUTH_ERROR";
  if (message.includes("Claude API 오류")) return "PROVIDER_ERROR";
  if (message.includes("JSON")) return "PARSE_ERROR";
  return "UNKNOWN";
}
