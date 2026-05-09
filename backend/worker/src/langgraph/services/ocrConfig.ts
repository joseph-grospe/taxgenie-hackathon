import type { WorkerEnv } from "@taxtrack/shared";

export const OCR_PROVIDER_AZURE_FOUNDRY = "azure_foundry";
export const OCR_PROVIDER_MISTRAL_DIRECT = "mistral_direct";
export const DEFAULT_AZURE_FOUNDRY_OCR_MODEL = "mistral-document-ai-2512";
export const DEFAULT_MISTRAL_DIRECT_OCR_MODEL = "mistral-ocr-latest";
export const DEFAULT_MISTRAL_DIRECT_OCR_API_URL =
  "https://api.mistral.ai/v1/ocr";
export const DEFAULT_OCR_TIMEOUT_MS = 180000;

export type OcrProvider =
  | typeof OCR_PROVIDER_AZURE_FOUNDRY
  | typeof OCR_PROVIDER_MISTRAL_DIRECT;

export interface OcrProviderConfig {
  provider: OcrProvider;
  apiKey: string;
  apiUrl: string;
  model: string;
  timeoutMs: number;
}

function firstConfigured(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === "string" && value.trim().length > 0);
}

function requireConfigured(value: string | undefined, message: string): string {
  const configured = firstConfigured(value);
  if (!configured) {
    throw new Error(message);
  }

  return configured;
}

export function resolveOcrConfig(env: WorkerEnv): OcrProviderConfig {
  const provider = env.OCR_PROVIDER ?? OCR_PROVIDER_AZURE_FOUNDRY;
  const timeoutMs =
    env.OCR_TIMEOUT_MS ?? env.MISTRAL_TIMEOUT_MS ?? DEFAULT_OCR_TIMEOUT_MS;

  if (provider === OCR_PROVIDER_MISTRAL_DIRECT) {
    return {
      provider,
      apiKey: requireConfigured(
        firstConfigured(env.MISTRAL_DIRECT_OCR_API_KEY, env.MISTRAL_API_KEY),
        "OCR provider mistral_direct requires MISTRAL_DIRECT_OCR_API_KEY or legacy MISTRAL_API_KEY.",
      ),
      apiUrl:
        firstConfigured(env.MISTRAL_DIRECT_OCR_API_URL, env.MISTRAL_API_URL) ??
        DEFAULT_MISTRAL_DIRECT_OCR_API_URL,
      model:
        firstConfigured(env.MISTRAL_DIRECT_OCR_MODEL, env.MISTRAL_MODEL) ??
        DEFAULT_MISTRAL_DIRECT_OCR_MODEL,
      timeoutMs,
    };
  }

  return {
    provider,
    apiKey: requireConfigured(
      firstConfigured(
        env.AZURE_FOUNDRY_OCR_API_KEY,
        env.MISTRAL_API_KEY,
        env.AZURE_API_KEY,
      ),
      "OCR provider azure_foundry requires AZURE_FOUNDRY_OCR_API_KEY, legacy MISTRAL_API_KEY, or legacy AZURE_API_KEY.",
    ),
    apiUrl: requireConfigured(
      firstConfigured(env.AZURE_FOUNDRY_OCR_API_URL, env.MISTRAL_API_URL),
      "OCR provider azure_foundry requires AZURE_FOUNDRY_OCR_API_URL or legacy MISTRAL_API_URL.",
    ),
    model:
      firstConfigured(env.AZURE_FOUNDRY_OCR_MODEL, env.MISTRAL_MODEL) ??
      DEFAULT_AZURE_FOUNDRY_OCR_MODEL,
    timeoutMs,
  };
}
