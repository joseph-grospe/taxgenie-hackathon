import {
  GoogleGenAI,
  MediaResolution,
  ThinkingLevel,
  type GenerateContentParameters,
  type GenerateContentResponse,
} from "@google/genai";
import type { Logger } from "@taxtrack/shared";
import type {
  DocumentExtractionClient,
  DocumentExtractionMetadata,
  DocumentExtractionRequest,
  DocumentExtractionUsage,
} from "./documentExtractionClient";
import {
  DOCUMENT_EXTRACTION_PROMPT,
  DOCUMENT_EXTRACTION_PROMPT_VERSION,
  DOCUMENT_EXTRACTION_RESPONSE_SCHEMA,
  DOCUMENT_EXTRACTION_SCHEMA_VERSION,
  documentExtractionResultSchema,
} from "./extractionContract";
import {
  PAYOR_SIGNER_EXTRACTION_PROMPT,
  PAYOR_SIGNER_EXTRACTION_PROMPT_VERSION,
  PAYOR_SIGNER_EXTRACTION_RESPONSE_SCHEMA,
  PAYOR_SIGNER_EXTRACTION_SCHEMA_VERSION,
  payorSignerExtractionResultSchema,
} from "./payorSignerContract";
import type {
  GeminiExtractionConfig,
  GeminiMediaResolution,
  GeminiThinkingLevel,
} from "./geminiConfig";

export interface GeminiClientConfig extends GeminiExtractionConfig {
  logger?: Logger;
}

type GenerateContent = (
  parameters: GenerateContentParameters,
) => Promise<GenerateContentResponse>;

export interface GeminiClientOptions {
  generateContent?: GenerateContent;
  sleep?: (durationMs: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
}

export class GeminiExtractionError extends Error {
  constructor(
    message: string,
    readonly telemetry: {
      attemptCount: number;
      latencyMs: number;
      status?: number;
      timeout: boolean;
      retryable: boolean;
    },
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "GeminiExtractionError";
  }
}

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const BASE_RETRY_DELAY_MS = 1_000;

const MEDIA_RESOLUTIONS: Record<GeminiMediaResolution, MediaResolution> = {
  low: MediaResolution.MEDIA_RESOLUTION_LOW,
  medium: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
  high: MediaResolution.MEDIA_RESOLUTION_HIGH,
};

const THINKING_LEVELS: Record<GeminiThinkingLevel, ThinkingLevel> = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeMimeType(mimeType: string): string {
  const normalized = mimeType.trim().toLowerCase();
  return normalized === "application/pdf" || normalized === "image/png"
    ? normalized
    : "application/pdf";
}

function getStatusCode(error: unknown): number | undefined {
  if (!isRecord(error)) {
    return undefined;
  }

  for (const key of ["status", "statusCode", "code"] as const) {
    const value = error[key];
    if (
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 100 &&
      value <= 599
    ) {
      return value;
    }
    if (typeof value === "string" && /^\d{3}$/u.test(value)) {
      return Number(value);
    }
  }

  const response = error.response;
  return isRecord(response) && typeof response.status === "number"
    ? response.status
    : undefined;
}

function getRetryAfterMs(error: unknown): number | undefined {
  if (!isRecord(error)) {
    return undefined;
  }

  const response = isRecord(error.response) ? error.response : undefined;
  const headers = response?.headers ?? error.headers;
  let retryAfter: unknown;
  if (isRecord(headers)) {
    retryAfter = headers["retry-after"] ?? headers["Retry-After"];
  } else if (
    headers &&
    typeof (headers as { get?: unknown }).get === "function"
  ) {
    retryAfter = (headers as { get(name: string): unknown }).get("retry-after");
  }

  if (typeof retryAfter === "number" && retryAfter >= 0) {
    return retryAfter * 1_000;
  }
  if (typeof retryAfter !== "string" || retryAfter.trim().length === 0) {
    return undefined;
  }

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1_000;
  }
  const retryAt = Date.parse(retryAfter);
  return Number.isFinite(retryAt)
    ? Math.max(0, retryAt - Date.now())
    : undefined;
}

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /abort|timed?\s*out|timeout/iu.test(`${error.name} ${error.message}`)
  );
}

function isRetryable(error: unknown): boolean {
  const status = getStatusCode(error);
  return (
    (status !== undefined && RETRYABLE_STATUS_CODES.has(status)) ||
    isTimeoutError(error)
  );
}

function parseResponse(response: GenerateContentResponse) {
  if (!response.candidates || response.candidates.length === 0) {
    const blockReason = response.promptFeedback?.blockReason;
    throw new Error(
      blockReason
        ? `Gemini extraction response was blocked (${blockReason}).`
        : "Gemini extraction response contained no candidates.",
    );
  }

  const text = response.text?.trim();
  if (!text) {
    throw new Error("Gemini extraction response contained empty JSON.");
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Gemini extraction response was not valid JSON.");
  }

  const parsed = documentExtractionResultSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Gemini extraction response failed schema validation: ${parsed.error.issues
        .slice(0, 5)
        .map(
          (issue) => `${issue.path.join(".") || "root"}: ${issue.message}`,
        )
        .join("; ")}`,
    );
  }
  return parsed.data;
}

function parsePayorSignerResponse(response: GenerateContentResponse) {
  if (!response.candidates || response.candidates.length === 0) {
    const blockReason = response.promptFeedback?.blockReason;
    throw new Error(
      blockReason
        ? `Gemini payor signer response was blocked (${blockReason}).`
        : "Gemini payor signer response contained no candidates.",
    );
  }

  const responseText = response.text?.trim();
  if (!responseText) {
    throw new Error("Gemini payor signer response contained empty JSON.");
  }

  let value: unknown;
  try {
    value = JSON.parse(responseText);
  } catch {
    throw new Error("Gemini payor signer response was not valid JSON.");
  }

  const parsed = payorSignerExtractionResultSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Gemini payor signer response failed schema validation: ${parsed.error.issues
        .slice(0, 5)
        .map(
          (issue) => `${issue.path.join(".") || "root"}: ${issue.message}`,
        )
        .join("; ")}`,
    );
  }
  return parsed.data;
}

function buildUsageMetadata(
  response: GenerateContentResponse,
): DocumentExtractionUsage {
  const usage = response.usageMetadata;
  return {
    promptTokenCount: usage?.promptTokenCount,
    outputTokenCount: usage?.candidatesTokenCount,
    thoughtTokenCount: usage?.thoughtsTokenCount,
    totalTokenCount: usage?.totalTokenCount,
  };
}

export function createGeminiClient(
  config: GeminiClientConfig,
  options: GeminiClientOptions = {},
): DocumentExtractionClient {
  const ai = options.generateContent
    ? undefined
    : new GoogleGenAI({ apiKey: config.apiKey });
  const generateContent =
    options.generateContent ??
    ((parameters: GenerateContentParameters) =>
      ai!.models.generateContent(parameters));
  const sleep =
    options.sleep ??
    ((durationMs: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, durationMs);
      }));
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now;

  async function executeStructuredRequest<T>(input: {
    request: DocumentExtractionRequest;
    prompt: string;
    responseSchema: object;
    promptVersion: string;
    schemaVersion: number;
    operation: "document" | "payor_signer";
    parse: (response: GenerateContentResponse) => T;
  }): Promise<{ result: T; metadata: DocumentExtractionMetadata }> {
    const startedAt = new Date().toISOString();
    const started = now();
    const parameters: GenerateContentParameters = {
      model: config.model,
      contents: [
        {
          role: "user",
          parts: [
            { text: input.prompt },
            {
              inlineData: {
                mimeType: normalizeMimeType(input.request.mimeType),
                data: input.request.content.toString("base64"),
              },
            },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: input.responseSchema,
        thinkingConfig: {
          thinkingLevel: THINKING_LEVELS[config.thinkingLevel],
          includeThoughts: false,
        },
        mediaResolution: MEDIA_RESOLUTIONS[config.mediaResolution],
        httpOptions: {
          timeout: config.timeoutMs,
          retryOptions: { attempts: 1 },
        },
      },
    };

    let response: GenerateContentResponse | undefined;
    let attemptCount = 0;
    while (attemptCount <= config.maxRetries) {
      attemptCount += 1;
      const abortController = new AbortController();
      const timeout = setTimeout(
        () => abortController.abort(),
        config.timeoutMs,
      );

      try {
        response = await generateContent({
          ...parameters,
          config: {
            ...parameters.config,
            abortSignal: abortController.signal,
          },
        });
        clearTimeout(timeout);
        break;
      } catch (error) {
        clearTimeout(timeout);
        const retryable = isRetryable(error);
        const status = getStatusCode(error);
        const timedOut = isTimeoutError(error);
        config.logger?.warn("gemini_extraction_request_failed", {
          provider: "gemini",
          operation: input.operation,
          model: config.model,
          sourceFileId: input.request.sourceFileId,
          revision: input.request.revision,
          attemptCount,
          status,
          retryable,
          timeout: timedOut,
        });

        if (!retryable || attemptCount > config.maxRetries) {
          const reason =
            status !== undefined
              ? `HTTP ${status}`
              : timedOut
                ? "timeout"
                : "request error";
          throw new GeminiExtractionError(
            `Gemini ${input.operation} extraction failed after ${attemptCount} attempt(s): ${reason}.`,
            {
              attemptCount,
              latencyMs: Math.max(0, now() - started),
              status,
              timeout: timedOut,
              retryable,
            },
            { cause: error },
          );
        }

        const exponentialMs = BASE_RETRY_DELAY_MS * 2 ** (attemptCount - 1);
        const jitterMs = Math.floor(exponentialMs * 0.25 * random());
        await sleep(
          Math.max(getRetryAfterMs(error) ?? 0, exponentialMs + jitterMs),
        );
      }
    }

    if (!response) {
      throw new GeminiExtractionError(
        `Gemini ${input.operation} extraction failed after ${attemptCount} attempt(s): no response.`,
        {
          attemptCount,
          latencyMs: Math.max(0, now() - started),
          timeout: false,
          retryable: false,
        },
      );
    }

    let result: T;
    try {
      result = input.parse(response);
    } catch (error) {
      throw new GeminiExtractionError(
        error instanceof Error
          ? error.message
          : `Gemini ${input.operation} extraction response was invalid.`,
        {
          attemptCount,
          latencyMs: Math.max(0, now() - started),
          timeout: false,
          retryable: false,
        },
        { cause: error },
      );
    }

    const finishedAt = new Date().toISOString();
    const latencyMs = now() - started;
    const usage = buildUsageMetadata(response);
    config.logger?.info("gemini_extraction_request_completed", {
      provider: "gemini",
      operation: input.operation,
      requestedModel: config.model,
      responseModel: response.modelVersion,
      promptVersion: input.promptVersion,
      schemaVersion: input.schemaVersion,
      sourceFileId: input.request.sourceFileId,
      revision: input.request.revision,
      attemptCount,
      latencyMs,
      ...usage,
    });

    return {
      result,
      metadata: {
        provider: "gemini",
        requestedModel: config.model,
        responseModel: response.modelVersion,
        promptVersion: input.promptVersion,
        schemaVersion: input.schemaVersion,
        thinkingLevel: config.thinkingLevel,
        mediaResolution: config.mediaResolution,
        startedAt,
        finishedAt,
        latencyMs,
        attemptCount,
        usage,
      },
    };
  }

  return {
    extract: (request) =>
      executeStructuredRequest({
        request,
        prompt: DOCUMENT_EXTRACTION_PROMPT,
        responseSchema: DOCUMENT_EXTRACTION_RESPONSE_SCHEMA,
        promptVersion: DOCUMENT_EXTRACTION_PROMPT_VERSION,
        schemaVersion: DOCUMENT_EXTRACTION_SCHEMA_VERSION,
        operation: "document",
        parse: parseResponse,
      }),
    extractPayorSigner: (request) =>
      executeStructuredRequest({
        request,
        prompt: PAYOR_SIGNER_EXTRACTION_PROMPT,
        responseSchema: PAYOR_SIGNER_EXTRACTION_RESPONSE_SCHEMA,
        promptVersion: PAYOR_SIGNER_EXTRACTION_PROMPT_VERSION,
        schemaVersion: PAYOR_SIGNER_EXTRACTION_SCHEMA_VERSION,
        operation: "payor_signer",
        parse: parsePayorSignerResponse,
      }),
  };
}
