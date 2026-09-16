import type { AIProvider, GenerateContentParams } from "../types";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-5";

export class ClaudeProvider implements AIProvider {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model = DEFAULT_MODEL) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async generateContent({
    systemPrompt,
    prompt,
    maxTokens = 2048,
    images,
    responseSchema,
  }: GenerateContentParams) {
    const content = images && images.length > 0
      ? [
          ...images.map((img) => ({
            type: "image",
            source: { type: "base64", media_type: img.mediaType, data: img.base64Data },
          })),
          { type: "text", text: prompt },
        ]
      : prompt;

    const requestBody: Record<string, unknown> = {
      model: this.model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content }],
    };

    // Force the model to reply through a tool call matching this schema
    // instead of free text — see the ResponseSchema doc comment in types.ts.
    if (responseSchema) {
      requestBody.tools = [
        {
          name: responseSchema.name,
          description: responseSchema.description,
          input_schema: responseSchema.schema,
        },
      ];
      requestBody.tool_choice = { type: "tool", name: responseSchema.name };
    }

    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Claude API 오류 (${response.status}): ${errorBody}`);
    }

    const data = await response.json();
    const usage = {
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
    };

    if (responseSchema) {
      const toolUseBlock = data.content?.find(
        (block: { type: string; name?: string }) =>
          block.type === "tool_use" && block.name === responseSchema.name,
      );
      if (!toolUseBlock) {
        throw new Error(
          "Claude API 응답에서 구조화된 데이터(tool_use)를 찾을 수 없습니다.",
        );
      }
      return { content: JSON.stringify(toolUseBlock.input), usage };
    }

    const text = data.content
      ?.filter((block: { type: string }) => block.type === "text")
      .map((block: { text: string }) => block.text)
      .join("");

    if (!text) {
      throw new Error("Claude API 응답에서 텍스트를 찾을 수 없습니다.");
    }

    return { content: text, usage };
  }
}
