import type { WorkerEnv } from "@taxgenie/shared";

export const DEFAULT_GEMINI_MODEL = "gemini-3-flash-preview";
export const DEFAULT_GEMINI_TIMEOUT_MS = 180_000;
export const DEFAULT_GEMINI_MAX_RETRIES = 2;

export type GeminiThinkingLevel = "minimal" | "low" | "medium" | "high";
export type GeminiMediaResolution = "low" | "medium" | "high";

export interface GeminiExtractionConfig {
  apiKey: string;
  model: string;
  timeoutMs: number;
  thinkingLevel: GeminiThinkingLevel;
  mediaResolution: GeminiMediaResolution;
  maxRetries: number;
}

export function resolveGeminiConfig(env: WorkerEnv): GeminiExtractionConfig {
  if (!env.GEMINI_API_KEY) {
    throw new Error("Gemini extraction requires GEMINI_API_KEY.");
  }

  return {
    apiKey: env.GEMINI_API_KEY,
    model: env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL,
    timeoutMs: env.GEMINI_TIMEOUT_MS ?? DEFAULT_GEMINI_TIMEOUT_MS,
    thinkingLevel: env.GEMINI_THINKING_LEVEL,
    mediaResolution: env.GEMINI_MEDIA_RESOLUTION,
    maxRetries: DEFAULT_GEMINI_MAX_RETRIES,
  };
}
