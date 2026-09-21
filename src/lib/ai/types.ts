export type ImageInput = {
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  base64Data: string;
};

// Forces the model to answer through Claude's tool-use mechanism instead of
// free-form text: the API itself constrains the model's output to valid JSON
// matching `schema` before it ever reaches us, so markdown fences, stray
// prose around the JSON, trailing commas, and unescaped quotes/newlines
// inside string values (the actual causes of the STEP34 "Expected ',' or
// '}'" parse failures) become structurally impossible instead of something
// we regex-repair after the fact.
export type ResponseSchema = {
  name: string;
  description: string;
  schema: Record<string, unknown>;
};

export type GenerateContentParams = {
  systemPrompt?: string;
  prompt: string;
  maxTokens?: number;
  images?: ImageInput[];
  responseSchema?: ResponseSchema;
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type GenerateContentResult = {
  content: string;
  usage: TokenUsage;
  // The provider's own stop reason, passed through untouched (Anthropic:
  // "end_turn" | "max_tokens" | "tool_use" | ...). Callers whose output must
  // be COMPLETE (structured results that get persisted) check it; callers
  // that don't care can ignore it. null when the provider didn't report one.
  stopReason?: string | null;
};

export interface AIProvider {
  generateContent(params: GenerateContentParams): Promise<GenerateContentResult>;
}
