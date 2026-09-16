export type ImageInput = {
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  base64Data: string;
};

export type GenerateContentParams = {
  systemPrompt?: string;
  prompt: string;
  maxTokens?: number;
  images?: ImageInput[];
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type GenerateContentResult = {
  content: string;
  usage: TokenUsage;
};

export interface AIProvider {
  generateContent(params: GenerateContentParams): Promise<GenerateContentResult>;
}
