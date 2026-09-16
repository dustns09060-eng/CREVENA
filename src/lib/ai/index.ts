import type { AIProvider } from "./types";
import { ClaudeProvider } from "./providers/claude";

export type { AIProvider, GenerateContentParams, ResponseSchema } from "./types";

export function getAIProvider(): AIProvider {
  const provider = process.env.AI_PROVIDER ?? "claude";

  switch (provider) {
    case "claude": {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error("ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.");
      }
      return new ClaudeProvider(apiKey, process.env.ANTHROPIC_MODEL);
    }
    default:
      throw new Error(`지원하지 않는 AI_PROVIDER 값입니다: ${provider}`);
  }
}
